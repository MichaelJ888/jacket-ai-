import { makeVideoFilename, VIDEO_DURATION_SECONDS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./mockup-logic.ts";

export const SOCIAL_PLATFORMS = [
  { id: "facebook", label: "Facebook Pages", integration: "existing-single-account", requirement: "Page authorization and publishing permissions; current publisher targets META_PAGE_ID." },
  { id: "instagram", label: "Instagram Business / Reels", integration: "existing-single-account", requirement: "Linked professional account, publishing permissions, and a supported video format." },
  { id: "youtube", label: "YouTube Shorts", integration: "existing-single-account", requirement: "Channel OAuth credentials, upload quota, and any required API verification." },
  { id: "tiktok", label: "TikTok", integration: "existing-single-account", requirement: "User authorization, video.publish approval, verified media URL domain, and audit for public posting." },
  { id: "linkedin", label: "LinkedIn", integration: "manual-export", requirement: "Manual upload for now; automated posting needs a separate authorized API integration." },
  { id: "other", label: "Other social networks", integration: "manual-export", requirement: "Manual export only. Each network needs its own supported API, permissions, and media checks." },
] as const;

export type SocialPlatform = typeof SOCIAL_PLATFORMS[number]["id"];
export type CampaignLanguage = "english" | "taglish";
export type CampaignInput = {
  clientName: string;
  productName: string;
  callToAction: string;
  language: CampaignLanguage;
  platforms: SocialPlatform[];
  accountLabels: Partial<Record<SocialPlatform, string>>;
};

export function buildCampaignPlan(input: CampaignInput) {
  const clientName = input.clientName.trim() || "YOUR TEAM";
  const productName = input.productName.trim() || "Custom jackets and uniforms";
  const callToAction = input.callToAction.trim() || "Message MJIC for a quotation";
  const caption = input.language === "taglish"
    ? `${productName} para sa ${clientName}. Ipakita ang identity ng inyong team gamit ang sarili ninyong design. ${callToAction}.`
    : `${productName} for ${clientName}. Represent your team with your own design. ${callToAction}.`;
  const voiceoverSuggestion = input.language === "taglish"
    ? `Sariling design, sariling identity. Custom apparel by MJIC. ${callToAction}.`
    : `Your design. Your team identity. Custom apparel by MJIC. ${callToAction}.`;

  return {
    schemaVersion: 1,
    status: "DRAFT",
    approvalStatus: "NOT_SUBMITTED",
    publishingPolicy: "APPROVED_CAMPAIGNS_ONLY",
    autoPublishEligible: false,
    queuedForPublishing: false,
    clientName,
    productName,
    callToAction,
    language: input.language,
    rendering: {
      engine: "browser",
      mimeType: "video/webm",
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      durationSeconds: VIDEO_DURATION_SECONDS,
      providerChargeUsd: 0,
      audioIncluded: false,
      note: "Uses your supplied artwork. No AI generation, voice synthesis, MP4 conversion, upload, or background rendering.",
    },
    caption,
    hashtags: ["#MJIC", "#CustomApparel", "#TeamWear"],
    voiceoverSuggestion,
    storyboard: [{ startSeconds: 0, endSeconds: VIDEO_DURATION_SECONDS, scene: "Supplied product image with client name, optional logo, product label, and call to action." }],
    targets: SOCIAL_PLATFORMS.filter((platform) => input.platforms.includes(platform.id)).flatMap((platform) => {
      const labels = [...new Set((input.accountLabels[platform.id] || "").split("\n").map((label) => label.trim()).filter(Boolean))];
      return (labels.length ? labels : [null]).map((accountLabel) => ({
        platform: platform.id,
        platformLabel: platform.label,
        accountLabel,
        accountVerified: false,
        integration: platform.integration,
        requirement: platform.requirement,
        caption,
        status: accountLabel ? "NEEDS_ACCOUNT_VERIFICATION" : "NEEDS_ACCOUNT_SELECTION",
        exportRequirement: "WebM preview only. Convert to a platform-supported format (commonly MP4/H.264) and verify before publishing.",
      }));
    }),
    nextSteps: [
      "Render and review the WebM; confirm rights to the supplied artwork and logos.",
      "Convert if required, then verify each platform and account. Account labels are planning notes, not connected accounts.",
      "Obtain campaign approval before scheduling. This local draft is not a server-side approval and is never added to the publishing queue.",
    ],
  } as const;
}

export function makeCampaignFilename(clientName: string) {
  return makeVideoFilename(clientName).replace("-mockup.webm", "-campaign-draft.json");
}
