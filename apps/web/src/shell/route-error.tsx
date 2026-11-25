import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { m } from "@slipstream/i18n";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { ErrorState } from "~/ui/states.tsx";

/** A route that failed to load: the statement, Try again, and the way home. */
export function RouteError({ reset }: ErrorComponentProps) {
  return (
    <Wrap className="py-16">
      <ErrorState
        title={m.error_unexpected()}
        actions={
          <>
            <Button variant="primary" onClick={reset}>
              {m.action_try_again()}
            </Button>
            <Button nativeButton={false} render={<Link to="/" />}>
              {m.state_go_home()}
            </Button>
          </>
        }
      />
    </Wrap>
  );
}

/** The 404 page. */
export function RouteNotFound() {
  return (
    <Wrap className="py-16">
      <ErrorState
        title={m.error_not_found()}
        actions={
          <Button variant="primary" nativeButton={false} render={<Link to="/" />}>
            {m.state_go_home()}
          </Button>
        }
      />
    </Wrap>
  );
}
