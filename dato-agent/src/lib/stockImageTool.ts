import type { FunctionTool } from 'openai/resources/responses/responses';

export const SEARCH_STOCK_IMAGES_TOOL_NAME = 'search_stock_images' as const;

export const STOCK_IMAGE_PROVIDERS = ['pexels', 'unsplash'] as const;

export type StockImageProvider = (typeof STOCK_IMAGE_PROVIDERS)[number];

const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/v1/search';
const UNSPLASH_SEARCH_ENDPOINT = 'https://api.unsplash.com/search/photos';
const UNSPLASH_UTM = 'utm_source=dato_agent&utm_medium=referral';
const DOWNLOAD_WIDTH = 2400;
const DEFAULT_PER_PAGE = 6;
const MAX_PER_PAGE = 15;
const MAX_QUERY_LENGTH = 200;

export const SEARCH_STOCK_IMAGES_TOOL = {
  type: 'function',
  name: SEARCH_STOCK_IMAGES_TOOL_NAME,
  description:
    'Search free stock photos on Pexels and Unsplash. This only reads the providers’ public search APIs and never changes DatoCMS. Use it when the editor asks you to find images, or when a page needs an image that the media library does not have. Show the editor a short list (preview link, photographer, provider) and let them choose. To save a chosen photo, call create_dato_asset with source url, the result’s download_url, and its author, copyright and notes values so the credit is stored on the asset.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description:
          'Concrete English search terms describing the subject, e.g. "surfer Peniche Supertubos wave".',
      },
      provider: {
        type: 'string',
        enum: ['pexels', 'unsplash', 'both'],
        description:
          'Which provider to search. Use both unless the editor asked for one.',
      },
      orientation: {
        type: ['string', 'null'],
        enum: ['landscape', 'portrait', 'square', null],
        description:
          'Preferred orientation, or null for any. Heroes and cards are usually landscape.',
      },
      per_page: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: MAX_PER_PAGE,
        description: `Results per provider (1-${MAX_PER_PAGE}), or null for ${DEFAULT_PER_PAGE}.`,
      },
    },
    required: ['query', 'provider', 'orientation', 'per_page'],
  },
} as const satisfies FunctionTool;

export type StockImageOrientation = 'landscape' | 'portrait' | 'square';

export type StockImageSearchInput = {
  query: string;
  providers: StockImageProvider[];
  orientation?: StockImageOrientation;
  perPage: number;
};

export type StockImage = {
  provider: StockImageProvider;
  id: string;
  width: number;
  height: number;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  page_url: string;
  preview_url: string;
  download_url: string;
  suggested_filename: string;
  author: string;
  copyright: string;
  notes: string;
};

export type StockImageSearchResult = {
  query: string;
  results: StockImage[];
  errors: { provider: StockImageProvider; message: string }[];
};

export type StockImageSearchCallback = (
  input: StockImageSearchInput,
  signal?: AbortSignal,
) => Promise<StockImageSearchResult>;

export type StockImageSearch = {
  providers: StockImageProvider[];
  search: StockImageSearchCallback;
  /**
   * Unsplash requires a download event whenever one of its photos is saved.
   * Unknown URLs are ignored, so this is safe to call for every URL upload.
   */
  trackDownload: (downloadUrl: string) => Promise<void>;
};

export type StockImageSearchKeys = {
  pexelsApiKey?: string;
  unsplashAccessKey?: string;
};

function parsedObject(rawArguments: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error('Stock image search arguments must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stock image search arguments must be an object.');
  }
  return parsed as Record<string, unknown>;
}

export function parseStockImageSearchInput(
  rawArguments: string,
): StockImageSearchInput {
  const value = parsedObject(rawArguments);
  const allowed = new Set(['query', 'provider', 'orientation', 'per_page']);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(
      `Stock image search arguments contain an unsupported key: ${unexpected}.`,
    );
  }

  const query = typeof value.query === 'string' ? value.query.trim() : '';
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new Error(`query must contain 1 to ${MAX_QUERY_LENGTH} characters.`);
  }

  const orientation = parseOrientation(value.orientation);
  return {
    query,
    providers: parseProviders(value.provider),
    ...(orientation ? { orientation } : {}),
    perPage: parsePerPage(value.per_page),
  };
}

function parseProviders(value: unknown): StockImageProvider[] {
  if (value === 'both') return [...STOCK_IMAGE_PROVIDERS];
  if (value === 'pexels' || value === 'unsplash') return [value];
  throw new Error('provider must be pexels, unsplash or both.');
}

function parseOrientation(value: unknown): StockImageOrientation | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'landscape' || value === 'portrait' || value === 'square') {
    return value;
  }
  throw new Error('orientation must be landscape, portrait, square or null.');
}

function parsePerPage(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_PER_PAGE;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PER_PAGE
  ) {
    throw new Error(`per_page must be an integer from 1 to ${MAX_PER_PAGE}.`);
  }
  return value;
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'photo'
  );
}

function withParams(rawUrl: string, params: Record<string, string>): string {
  const url = new URL(rawUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mapPexelsPhoto(photo: unknown): StockImage | undefined {
  if (!isRecord(photo) || !isRecord(photo.src)) return undefined;
  const id = String(photo.id ?? '');
  const original = stringField(photo.src.original);
  const pageUrl = stringField(photo.url);
  if (!id || !original || !pageUrl) return undefined;
  const photographer = stringField(photo.photographer) || 'Unknown';
  const alt = stringField(photo.alt) || null;
  return {
    provider: 'pexels',
    id,
    width: numberField(photo.width),
    height: numberField(photo.height),
    alt,
    photographer,
    photographer_url: stringField(photo.photographer_url),
    page_url: pageUrl,
    preview_url: stringField(photo.src.medium) || original,
    download_url: withParams(original, {
      auto: 'compress',
      cs: 'tinysrgb',
      w: String(DOWNLOAD_WIDTH),
    }),
    suggested_filename: `${slugify(alt ?? `pexels ${id}`)}-pexels-${id}.jpg`,
    author: photographer,
    copyright: `Photo by ${photographer} on Pexels`,
    notes: `Source: ${pageUrl} (Pexels License)`,
  };
}

export function mapUnsplashPhoto(
  photo: unknown,
): { image: StockImage; downloadLocation: string } | undefined {
  if (
    !isRecord(photo) ||
    !isRecord(photo.urls) ||
    !isRecord(photo.links) ||
    !isRecord(photo.user)
  ) {
    return undefined;
  }
  const id = stringField(photo.id);
  const raw = stringField(photo.urls.raw);
  const pageUrl = stringField(photo.links.html);
  const downloadLocation = stringField(photo.links.download_location);
  if (!id || !raw || !pageUrl || !downloadLocation) return undefined;
  const photographer = stringField(photo.user.name) || 'Unknown';
  const userLinks = isRecord(photo.user.links) ? photo.user.links : {};
  const alt =
    stringField(photo.alt_description) ||
    stringField(photo.description) ||
    null;
  const creditPage = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}${UNSPLASH_UTM}`;
  const photographerUrl = stringField(userLinks.html);
  return {
    downloadLocation,
    image: {
      provider: 'unsplash',
      id,
      width: numberField(photo.width),
      height: numberField(photo.height),
      alt,
      photographer,
      photographer_url: photographerUrl
        ? `${photographerUrl}?${UNSPLASH_UTM}`
        : '',
      page_url: creditPage,
      preview_url: stringField(photo.urls.small) || raw,
      download_url: withParams(raw, {
        w: String(DOWNLOAD_WIDTH),
        q: '80',
        fm: 'jpg',
      }),
      suggested_filename: `${slugify(alt ?? `unsplash ${id}`)}-unsplash-${id}.jpg`,
      author: photographer,
      copyright: `Photo by ${photographer} on Unsplash`,
      notes: `Source: ${creditPage} (Unsplash License)`,
    },
  };
}

async function readJson(response: Response, provider: string) {
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? `${provider} rejected the API key.`
        : `${provider} search failed (${response.status}).`,
    );
  }
  return (await response.json()) as unknown;
}

export function createStockImageSearch(
  keys: StockImageSearchKeys,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): StockImageSearch | undefined {
  const pexelsApiKey = keys.pexelsApiKey?.trim() ?? '';
  const unsplashAccessKey = keys.unsplashAccessKey?.trim() ?? '';
  const configured = STOCK_IMAGE_PROVIDERS.filter((provider) =>
    provider === 'pexels' ? Boolean(pexelsApiKey) : Boolean(unsplashAccessKey),
  );
  if (configured.length === 0) return undefined;

  const unsplashDownloads = new Map<string, string>();

  const searchPexels = async (
    input: StockImageSearchInput,
    signal?: AbortSignal,
  ): Promise<StockImage[]> => {
    const url = new URL(PEXELS_SEARCH_ENDPOINT);
    url.searchParams.set('query', input.query);
    url.searchParams.set('per_page', String(input.perPage));
    if (input.orientation) {
      url.searchParams.set('orientation', input.orientation);
    }
    const body = await readJson(
      await fetchImpl(url, {
        headers: { Authorization: pexelsApiKey },
        credentials: 'omit',
        signal,
      }),
      'Pexels',
    );
    const photos =
      isRecord(body) && Array.isArray(body.photos) ? body.photos : [];
    return photos.flatMap((photo) => mapPexelsPhoto(photo) ?? []);
  };

  const searchUnsplash = async (
    input: StockImageSearchInput,
    signal?: AbortSignal,
  ): Promise<StockImage[]> => {
    const url = new URL(UNSPLASH_SEARCH_ENDPOINT);
    url.searchParams.set('query', input.query);
    url.searchParams.set('per_page', String(input.perPage));
    url.searchParams.set('content_filter', 'high');
    if (input.orientation) {
      url.searchParams.set(
        'orientation',
        input.orientation === 'square' ? 'squarish' : input.orientation,
      );
    }
    const body = await readJson(
      await fetchImpl(url, {
        headers: {
          Authorization: `Client-ID ${unsplashAccessKey}`,
          'Accept-Version': 'v1',
        },
        credentials: 'omit',
        signal,
      }),
      'Unsplash',
    );
    const photos =
      isRecord(body) && Array.isArray(body.results) ? body.results : [];
    return photos.flatMap((photo) => {
      const mapped = mapUnsplashPhoto(photo);
      if (!mapped) return [];
      unsplashDownloads.set(mapped.image.download_url, mapped.downloadLocation);
      return [mapped.image];
    });
  };

  return {
    providers: configured,
    search: async (input, signal) => {
      const requested = input.providers.filter((provider) =>
        configured.includes(provider),
      );
      const errors: StockImageSearchResult['errors'] = input.providers
        .filter((provider) => !configured.includes(provider))
        .map((provider) => ({
          provider,
          message: `No ${provider === 'pexels' ? 'Pexels' : 'Unsplash'} key is configured in the plugin settings.`,
        }));
      const settled = await Promise.allSettled(
        requested.map((provider) =>
          provider === 'pexels'
            ? searchPexels(input, signal)
            : searchUnsplash(input, signal),
        ),
      );
      const results: StockImage[] = [];
      settled.forEach((outcome, index) => {
        const provider = requested[index] as StockImageProvider;
        if (outcome.status === 'fulfilled') {
          results.push(...outcome.value);
        } else {
          errors.push({
            provider,
            message:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : 'Search failed.',
          });
        }
      });
      signal?.throwIfAborted();
      return { query: input.query, results, errors };
    },
    trackDownload: async (downloadUrl) => {
      const location = unsplashDownloads.get(downloadUrl);
      if (!location) return;
      try {
        await fetchImpl(location, {
          headers: {
            Authorization: `Client-ID ${unsplashAccessKey}`,
            'Accept-Version': 'v1',
          },
          credentials: 'omit',
        });
      } catch {
        // The upload already succeeded; a missed tracking ping must not fail it.
      }
    },
  };
}
