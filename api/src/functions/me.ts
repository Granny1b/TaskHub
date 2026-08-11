import { app } from '@azure/functions';
import { rolesFor } from '../lib/authorization.js';
import { ok, withAuth } from '../lib/http.js';

/**
 * Who am I?
 *
 * The client uses this to render the account menu and to decide whether to show
 * admin affordances. It returns only what the server already knows from the
 * validated principal — nothing here is client-supplied.
 *
 * Note that reaching this endpoint at all means the caller passed the allowlist
 * gate. On the SWA Free tier that is the meaningful check: authentication says
 * someone signed in with a Microsoft account, and authorisation says they are
 * one of ours (docs/VERIFICATION.md §1).
 */
app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: withAuth(async ({ principal, policy }) =>
    ok({
      userId: principal.userId,
      userDetails: principal.userDetails,
      identityProvider: principal.identityProvider,
      roles: rolesFor(principal, policy),
    }),
  ),
});
