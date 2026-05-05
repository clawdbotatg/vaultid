import type { Metadata } from "next";

// Prefer NEXT_PUBLIC_PRODUCTION_URL (the absolute origin where the static export
// is served) so OG and Twitter previews resolve absolute URLs even on IPFS.
const baseUrl = process.env.NEXT_PUBLIC_PRODUCTION_URL
  ? process.env.NEXT_PUBLIC_PRODUCTION_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:${process.env.PORT || 3000}`;

const titleTemplate = "%s | VaultID";

export const getMetadata = ({
  title,
  description,
  imageRelativePath = "/thumbnail.svg",
}: {
  title: string;
  description: string;
  imageRelativePath?: string;
}): Metadata => {
  const imageUrl = `${baseUrl}${imageRelativePath}`;

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: title,
      template: titleTemplate,
    },
    description: description,
    openGraph: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [
        {
          url: imageUrl,
        },
      ],
    },
    twitter: {
      title: {
        default: title,
        template: titleTemplate,
      },
      description: description,
      images: [imageUrl],
    },
    icons: {
      icon: [
        {
          url: "/favicon.svg",
          type: "image/svg+xml",
        },
      ],
    },
  };
};
