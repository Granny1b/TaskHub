/**
 * Function app entry point.
 *
 * The v4 programming model registers handlers as a side effect of importing the
 * module that calls `app.http(...)`, so every route file must be imported here.
 * A route that is not imported simply does not exist at runtime, with no error.
 */
import './functions/tasks.js';
import './functions/lists.js';
import './functions/attachments.js';
import './functions/me.js';
