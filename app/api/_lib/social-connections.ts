export type SocialProvider =
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'shopee'
  | 'lazada'
  | 'x'
  | 'linkedin';

export type SocialConnectionState = 'active' | 'not_linked' | 'error' | 'unverified';

export type SocialConnection = {
  id: SocialProvider;
  label: string;
  state: SocialConnectionState;
  detail: string;
  configured: boolean;
  setupUrl: string;
  checklist: string[];
};

const META_SETUP = [
  'Confirm the MJIC Facebook Page is assigned to the Meta app.',
  'Connect using the Facebook OAuth button and select the intended Page.',
  'Run Check health to verify the token, webhook subscription, and Instagram account.',
];

export const SOCIAL_PROVIDER_SETUP: Record<SocialProvider, Pick<SocialConnection, 'label' | 'setupUrl' | 'checklist'>> = {
  facebook: {
    label: 'Facebook',
    setupUrl: 'https://developers.facebook.com/apps/',
    checklist: META_SETUP,
  },
  instagram: {
    label: 'Instagram',
    setupUrl: 'https://developers.facebook.com/apps/',
    checklist: [
      'Use a professional Instagram account linked to the intended Facebook Page.',
      'Connect that Facebook Page with the Facebook OAuth button.',
      'Run Check health and confirm the Instagram account check is green.',
    ],
  },
  tiktok: {
    label: 'TikTok',
    setupUrl: 'https://developers.tiktok.com/',
    checklist: [
      'Create or select the MJIC TikTok developer app and request Content Posting API access.',
      'Complete the app review and authorize the intended TikTok account.',
      'Add the issued access token to the deployment environment as TIKTOK_ACCESS_TOKEN.',
    ],
  },
  youtube: {
    label: 'YouTube',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    checklist: [
      'Enable the YouTube Data API and configure an OAuth consent screen.',
      'Create OAuth credentials and authorize the MJIC channel.',
      'Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN in the deployment environment.',
    ],
  },
  shopee: {
    label: 'Shopee',
    setupUrl: 'https://open.shopee.com/',
    checklist: [
      'Register the MJIC seller application in Shopee Open Platform.',
      'Complete platform review and authorize the seller account.',
      'Store the issued app credentials and shop authorization securely in the deployment environment.',
    ],
  },
  lazada: {
    label: 'Lazada',
    setupUrl: 'https://open.lazada.com/',
    checklist: [
      'Register the MJIC application in Lazada Open Platform.',
      'Complete platform review and authorize the intended seller account.',
      'Store the issued app credentials and seller authorization securely in the deployment environment.',
    ],
  },
  x: {
    label: 'X (Twitter)',
    setupUrl: 'https://developer.x.com/en/portal/dashboard',
    checklist: [
      'Create a project and app in the X Developer Portal with an appropriate access tier.',
      'Enable the required read/write permissions and authorize the MJIC account.',
      'Store the issued credentials securely in the deployment environment.',
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    setupUrl: 'https://www.linkedin.com/developers/apps',
    checklist: [
      'Create a LinkedIn application owned by MJIC.',
      'Request the products and organization permissions needed for publishing.',
      'Complete review, authorize the MJIC organization, and store credentials in the deployment environment.',
    ],
  },
};

export const SOCIAL_PROVIDER_IDS: SocialProvider[] = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'shopee',
  'lazada',
  'x',
  'linkedin',
];

export function socialProviderConfigured(provider: SocialProvider, configuredNames: ReadonlySet<string>): boolean {
  if (provider === 'facebook' || provider === 'instagram') {
    return configuredNames.has('META_APP_ID') && configuredNames.has('META_APP_SECRET');
  }
  if (provider === 'tiktok') return configuredNames.has('TIKTOK_ACCESS_TOKEN');
  if (provider === 'youtube') {
    return ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'].every((name) => configuredNames.has(name));
  }
  return false;
}

export function socialConnection(
  provider: SocialProvider,
  state: SocialConnectionState,
  detail: string,
  configured: boolean,
): SocialConnection {
  return { id: provider, ...SOCIAL_PROVIDER_SETUP[provider], state, detail, configured };
}
