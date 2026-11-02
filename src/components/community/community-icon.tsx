import React from "react";
import { Gamepad2, Globe, Link2, Megaphone, MessageCircle, Send, ShoppingBag, Users } from "lucide-react";
import { Instagram, Youtube } from "@/components/ui/icons";
import { resolveIconKey, type CommunityIconKey } from "@/lib/community/links";

interface IconProps {
  size?: number;
  className?: string;
}

function StrokeIcon({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function TikTok(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </StrokeIcon>
  );
}

function Facebook(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </StrokeIcon>
  );
}

function XIcon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 4l11.733 16H20L8.267 4z" />
      <path d="M4 20l6.768-6.768M13.228 10.772L20 4" />
    </StrokeIcon>
  );
}

// Los íconos de marca de ui/icons.tsx son SVG planos: se les pasa el tamaño como width/height.
function InstagramIcon({ size = 24, className }: IconProps) {
  return <Instagram width={size} height={size} className={className} aria-hidden="true" />;
}

function YoutubeIcon({ size = 24, className }: IconProps) {
  return <Youtube width={size} height={size} className={className} aria-hidden="true" />;
}

const ICONS: Record<CommunityIconKey, React.ComponentType<IconProps>> = {
  instagram: InstagramIcon,
  youtube: YoutubeIcon,
  tiktok: TikTok,
  facebook: Facebook,
  x: XIcon,
  discord: Gamepad2,
  whatsapp: MessageCircle,
  telegram: Send,
  globe: Globe,
  store: ShoppingBag,
  users: Users,
  megaphone: Megaphone,
  link: Link2,
};

export function IconByKey({ iconKey, ...props }: IconProps & { iconKey: CommunityIconKey }) {
  const Icon = ICONS[iconKey];
  return <Icon {...props} />;
}

/** Icono de un enlace: el elegido por el Admin o, si no hay, el de su plataforma. */
export function CommunityIcon({ link, ...props }: IconProps & { link: { iconKey: string | null; platform: string } }) {
  return <IconByKey iconKey={resolveIconKey(link)} {...props} />;
}
