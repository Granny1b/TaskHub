/**
 * @taskhub/shared — the domain, imported by both the web app and the Functions.
 *
 * Nothing in here may import the Azure SDK or a Node built-in: this package is
 * bundled into the browser. That rule is enforced by ESLint, not convention.
 */

/* Configuration — the knobs that make future change a config edit. */
export * from './config/completionPolicy.js';
export * from './config/features.js';
export * from './config/fieldRegistry.js';
export * from './config/viewRegistry.js';

/* Domain. */
export * from './domain/attachments.js';
export * from './domain/completion.js';
export * from './domain/constants.js';
export * from './domain/context.js';
export * from './domain/dates.js';
export * from './domain/documents.js';
export * from './domain/errors.js';
export * from './domain/events.js';
export * from './domain/ids.js';
export * from './domain/metadata.js';
export * from './domain/migrations.js';
export * from './domain/ordering.js';
export * from './domain/schemas.js';
export * from './domain/taskLists.js';
export * from './domain/tree.js';
