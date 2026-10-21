import { describe, expect, it, vi } from 'vitest';
import {
  createStockImageSearch,
  mapPexelsPhoto,
  mapUnsplashPhoto,
  parseStockImageSearchInput,
} from './stockImageTool';

const pexelsPhoto = {
  id: 1234,
  width: 6000,
  height: 4000,
  url: 'https://www.pexels.com/photo/surfer-1234/',
  photographer: 'Ana Silva',
  photographer_url: 'https://www.pexels.com/@ana',
  alt: 'Surfer riding a wave in Peniche',
  src: {
    original: 'https://images.pexels.com/photos/1234/pexels-photo-1234.jpeg',
    medium:
      'https://images.pexels.com/photos/1234/pexels-photo-1234.jpeg?h=350',
  },
};

const unsplashPhoto = {
  id: 'abc',
  width: 5000,
  height: 3333,
  alt_description: 'golf course by the ocean',
  description: null,
  urls: {
    raw: 'https://images.unsplash.com/photo-abc?ixid=xyz',
    small: 'https://images.unsplash.com/photo-abc?ixid=xyz&w=400',
  },
  links: {
    html: 'https://unsplash.com/photos/abc',
    download_location: 'https://api.unsplash.com/photos/abc/download?ixid=xyz',
  },
  user: { name: 'João Costa', links: { html: 'https://unsplash.com/@joao' } },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseStockImageSearchInput', () => {
  it('expands both providers and applies defaults', () => {
    expect(
      parseStockImageSearchInput(
        JSON.stringify({
          query: '  surf Ericeira ',
          provider: 'both',
          orientation: null,
          per_page: null,
        }),
      ),
    ).toEqual({
      query: 'surf Ericeira',
      providers: ['pexels', 'unsplash'],
      perPage: 6,
    });
  });

  it.each([
    [{ query: '', provider: 'both', orientation: null, per_page: null }],
    [{ query: 'golf', provider: 'flickr', orientation: null, per_page: null }],
    [{ query: 'golf', provider: 'both', orientation: 'wide', per_page: null }],
    [{ query: 'golf', provider: 'both', orientation: null, per_page: 40 }],
    [
      {
        query: 'golf',
        provider: 'both',
        orientation: null,
        per_page: null,
        extra: true,
      },
    ],
  ])('rejects invalid arguments %#', (args) => {
    expect(() => parseStockImageSearchInput(JSON.stringify(args))).toThrow();
  });
});

describe('stock photo mapping', () => {
  it('maps a Pexels photo with a sized download URL and credit', () => {
    const image = mapPexelsPhoto(pexelsPhoto);
    expect(image).toMatchObject({
      provider: 'pexels',
      id: '1234',
      author: 'Ana Silva',
      copyright: 'Photo by Ana Silva on Pexels',
      suggested_filename: 'surfer-riding-a-wave-in-peniche-pexels-1234.jpg',
    });
    expect(new URL(image?.download_url ?? '').searchParams.get('w')).toBe(
      '2400',
    );
    expect(image?.notes).toContain('https://www.pexels.com/photo/surfer-1234/');
  });

  it('maps an Unsplash photo with referral links and keeps its download location', () => {
    const mapped = mapUnsplashPhoto(unsplashPhoto);
    expect(mapped?.downloadLocation).toBe(
      unsplashPhoto.links.download_location,
    );
    expect(mapped?.image.copyright).toBe('Photo by João Costa on Unsplash');
    expect(mapped?.image.page_url).toContain('utm_medium=referral');
    expect(
      new URL(mapped?.image.download_url ?? '').searchParams.get('ixid'),
    ).toBe('xyz');
  });

  it('skips incomplete provider results', () => {
    expect(mapPexelsPhoto({ id: 1 })).toBeUndefined();
    expect(mapUnsplashPhoto({ id: 'x', urls: {} })).toBeUndefined();
  });
});

describe('createStockImageSearch', () => {
  it('is unavailable without any key', () => {
    expect(createStockImageSearch({})).toBeUndefined();
    expect(
      createStockImageSearch({ pexelsApiKey: ' ', unsplashAccessKey: '' }),
    ).toBeUndefined();
  });

  it('searches configured providers, reports missing ones, and tracks Unsplash downloads', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('https://api.unsplash.com/search/photos')) {
        return jsonResponse({ results: [unsplashPhoto] });
      }
      return jsonResponse({});
    });
    const search = createStockImageSearch(
      { unsplashAccessKey: 'unsplash-key' },
      fetchImpl,
    );
    expect(search?.providers).toEqual(['unsplash']);

    const result = await search?.search({
      query: 'golf Algarve',
      providers: ['pexels', 'unsplash'],
      orientation: 'square',
      perPage: 3,
    });

    expect(result?.results).toHaveLength(1);
    expect(result?.errors).toEqual([
      expect.objectContaining({ provider: 'pexels' }),
    ]);
    const searchUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(searchUrl.searchParams.get('orientation')).toBe('squarish');
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Client-ID unsplash-key');

    await search?.trackDownload(result?.results[0]?.download_url ?? '');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      unsplashPhoto.links.download_location,
    );

    await search?.trackDownload('https://example.com/other.jpg');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a rejected key without failing the other provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith('https://api.pexels.com')
        ? jsonResponse({ photos: [pexelsPhoto] })
        : jsonResponse({ errors: ['OAuth error'] }, 401),
    );
    const search = createStockImageSearch(
      { pexelsApiKey: 'pexels-key', unsplashAccessKey: 'bad' },
      fetchImpl,
    );

    const result = await search?.search({
      query: 'bike Madeira',
      providers: ['pexels', 'unsplash'],
      perPage: 6,
    });

    expect(result?.results.map((image) => image.provider)).toEqual(['pexels']);
    expect(result?.errors).toEqual([
      { provider: 'unsplash', message: 'Unsplash rejected the API key.' },
    ]);
  });
});
