import type { CSSProperties } from "react";
import { avatarInitials, type AvatarTone } from "@slipstream/domain";

/**
 * A person's avatar: initials on their profile's tone (amber when the tone is unknown).
 * Decorative; the name is always beside it.
 */
export function Avatar({
  name,
  tone,
  size = 34,
}: {
  name: string;
  tone?: AvatarTone | undefined;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      data-tone={tone}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </span>
  );
}

/** A tone's swatch for the tone picker: the avatar without initials. */
export function AvatarSwatch({ tone, size = 28 }: { tone: AvatarTone; size?: number }) {
  return (
    <span
      className="avatar"
      data-tone={tone}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
