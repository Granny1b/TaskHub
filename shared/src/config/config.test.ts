import { describe, expect, it } from 'vitest';
import { features, isEnabled, type FeatureName } from './features.js';
import { fieldRegistry, fieldsForDepth, listColumnFields } from './fieldRegistry.js';
import { DEFAULT_VIEW, enabledViews, viewRegistry } from './viewRegistry.js';

describe('feature flags', () => {
  it('defaults every out-of-scope feature to false, as the spec requires', () => {
    const outOfScope: FeatureName[] = [
      'realtimeCollaboration',
      'notifications',
      'ganttView',
      'calendarView',
      'timeTracking',
      'taskComments',
      'mentions',
      'recurringTasks',
      'monitorG5Integration',
      'attachmentContentSearch',
      'cascadeComplete',
    ];

    for (const name of outOfScope) {
      expect(isEnabled(name), `${name} must default to false in v1`).toBe(false);
    }
  });

  it('ships nothing enabled by default', () => {
    expect(Object.values(features).some(Boolean)).toBe(false);
  });
});

describe('field registry', () => {
  it('is empty in v1 — priority, assignee and labels are deliberately not fields', () => {
    expect(fieldRegistry).toEqual([]);
    expect(fieldsForDepth(0)).toEqual([]);
    expect(listColumnFields()).toEqual([]);
  });
});

describe('view registry', () => {
  it('has exactly one enabled view in v1', () => {
    expect(enabledViews().map((view) => view.id)).toEqual(['list']);
    expect(DEFAULT_VIEW).toBe('list');
  });

  it('routes labels through i18n keys rather than literals', () => {
    for (const view of viewRegistry) {
      expect(view.labelKey).toMatch(/^[a-z]+\./);
    }
  });
});
