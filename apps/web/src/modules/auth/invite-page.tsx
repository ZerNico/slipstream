import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { passwordMinLength } from "@slipstream/api";
import { DateTime } from "effect";
import { useState } from "react";
import { m } from "@slipstream/i18n";
import { ResultNote } from "~/ui/result-note.tsx";
import { useQueries } from "~/api/hooks.ts";
import { useAcceptInvite } from "./queries.ts";
import { Field } from "~/ui/controls.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { AuthHeading, AuthLayout } from "./auth-layout.tsx";
import { inviteError, passwordHint } from "./auth-text.ts";

/** Placeholder text that wraps like a sentence, so the skeleton never widens the page. */
const wordsPlaceholder = (words: number): string =>
  Array.from({ length: words }, () => "00000").join(" ");

/**
 * A guest's invite link (`/invite?token=…`, SPEC §7.8): who invited them and what they will
 * see, then their name, a username and a password. Accepting signs them in. A used, withdrawn
 * or expired link says so and what to do.
 */
export function InvitePage({ token }: { token: string | undefined }) {
  const queries = useQueries();
  const navigate = useNavigate();
  const preview = useQuery({
    ...queries.invitePreview(token ?? ""),
    enabled: token !== undefined,
  });
  const accept = useAcceptInvite();
  const [name, setName] = useState<string | undefined>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);

  if (token === undefined || preview.isError) {
    return (
      <AuthLayout>
        <AuthHeading title={m.invite_page_broken_title()} />
        <ResultNote tone="error">
          {token === undefined ? m.invite_unknown() : inviteError(preview.error)}
        </ResultNote>
        {/* A used link usually means the account exists already: signing in is the way on. */}
        <Button size="lg" nativeButton={false} render={<Link to="/login" />}>
          {m.signin_submit()}
        </Button>
      </AuthLayout>
    );
  }

  const invite = preview.data;
  const displayName = name ?? invite?.name ?? "";
  const restricted =
    invite !== undefined &&
    (invite.access.channelIds !== undefined || invite.access.collectionIds !== undefined);
  const errors = {
    name: displayName.trim() === "" ? m.profile_name_missing() : undefined,
    username: username.trim() === "" ? m.setup_username_missing() : undefined,
    password: password.length < passwordMinLength ? passwordHint(password) : undefined,
  };
  const valid = Object.values(errors).every((error) => error === undefined);
  const shown = (error: string | undefined) => (touched && error !== undefined ? { error } : {});

  return (
    <AuthLayout>
      <LoadingScope loading={preview.isPending} className="grid gap-5">
        <div>
          <h1 className="type-h1">
            <Sk placeholder={wordsPlaceholder(4)}>
              {invite === undefined ? undefined : m.invite_page_title({ name: invite.invitedBy })}
            </Sk>
          </h1>
          <p className="mt-1.5 text-fg-2">
            <Sk placeholder={wordsPlaceholder(12)}>
              {invite === undefined
                ? undefined
                : [
                    restricted ? m.invite_page_limited() : m.invite_page_everything(),
                    invite.access.mayRecord
                      ? m.invite_page_may_record()
                      : m.invite_page_no_record(),
                    ...(invite.expiresAt === undefined
                      ? []
                      : [
                          m.invite_page_valid_until({
                            at: new Date(DateTime.toEpochMillis(invite.expiresAt)),
                          }),
                        ]),
                  ].join(" ")}
            </Sk>
          </p>
        </div>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!valid) return;
            accept.mutate(
              {
                token,
                username: username.trim(),
                password,
                displayName: displayName.trim(),
              },
              { onSuccess: () => void navigate({ to: "/", replace: true }) },
            );
          }}
        >
          <Field
            reserve
            label={m.setup_display_name()}
            htmlFor="invite-name"
            {...shown(errors.name)}
          >
            <Input
              id="invite-name"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            reserve
            label={m.signin_username()}
            htmlFor="invite-username"
            {...shown(errors.username)}
          >
            <Input
              id="invite-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field
            label={m.signin_password()}
            htmlFor="invite-password"
            hint={passwordHint(password)}
            {...shown(errors.password)}
          >
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {accept.isError ? (
            <ResultNote tone="error">{inviteError(accept.error)}</ResultNote>
          ) : null}
          <Button variant="primary" size="lg" type="submit" busy={accept.isPending}>
            {m.invite_page_accept()}
          </Button>
        </form>
      </LoadingScope>
    </AuthLayout>
  );
}
