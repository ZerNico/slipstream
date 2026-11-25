import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useLogin } from "~/api/mutations.ts";
import { m } from "@slipstream/i18n";
import { Field } from "~/ui/controls.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { AuthHeading, AuthLayout } from "./auth-layout.tsx";
import { safeRedirect, signInError } from "./auth-text.ts";

/**
 * Sign-in (SPEC §8.8): username and password with the error inline under the password, then
 * back to where the person was. TVs sign in with a code instead, which the hint explains.
 */
export function LoginPage({ redirect }: { redirect: string | undefined }) {
  const navigate = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const error = login.isError ? signInError(login.error) : undefined;

  return (
    <AuthLayout>
      <AuthHeading
        title={m.signin_welcome()}
        text={m.signin_to_server({ host: window.location.host })}
      />
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (username.trim() === "" || password === "") return;
          login.mutate(
            { username: username.trim(), password },
            {
              onSuccess: () =>
                void navigate({ href: safeRedirect(redirect) ?? "/", replace: true }),
            },
          );
        }}
      >
        <Field label={m.signin_username()} htmlFor="login-username">
          <Input
            id="login-username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field
          label={m.signin_password()}
          reserve
          htmlFor="login-password"
          {...(error === undefined ? {} : { error })}
        >
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={error === undefined ? undefined : true}
            onChange={(event) => {
              setPassword(event.target.value);
              login.reset();
            }}
          />
        </Field>
        <Button
          variant="primary"
          size="lg"
          type="submit"
          busy={login.isPending}
          disabled={username.trim() === "" || password === ""}
        >
          {m.signin_submit()}
        </Button>
      </form>
      <p className="text-center text-[12.5px] text-fg-3">{m.signin_tv_hint()}</p>
    </AuthLayout>
  );
}
