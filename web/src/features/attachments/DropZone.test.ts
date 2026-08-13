import { describe, expect, it } from 'vitest';
import { classifyDrop } from './DropZone.js';

/**
 * A stand-in for the browser's DataTransfer.
 *
 * Only the two fields the classifier reads. The interesting case cannot be
 * produced in a test at all — it needs Outlook and Windows — so what is pinned
 * here is the *shape* Outlook produces: types announced, files empty.
 */
function transfer(options: { files?: unknown[]; types?: string[] } = {}): DataTransfer {
  return {
    files: options.files ?? [],
    types: options.types ?? [],
  } as unknown as DataTransfer;
}

describe('classifyDrop', () => {
  it('passes real files through', () => {
    const file = new File(['x'], 'ritning.pdf', { type: 'application/pdf' });
    const outcome = classifyDrop(transfer({ files: [file], types: ['Files'] }));

    expect(outcome.kind).toBe('files');
    expect(outcome.kind === 'files' ? outcome.files : []).toHaveLength(1);
  });

  it('reports a drop that announced something but carried no file', () => {
    /*
      This is Outlook.

      Dragging a mail out of Outlook announces `Files` among the types — the
      drag genuinely claims to be a file — but `files` is empty, because the
      mail is not on disk and the payload is an OLE descriptor the browser will
      not translate. Treating this as "nothing happened" is what made the drop
      look like a broken app.
    */
    const outcome = classifyDrop(transfer({ files: [], types: ['Files'] }));
    expect(outcome.kind).toBe('nothing-usable');
  });

  it('also reports a text or URL drop, which likewise yields no file', () => {
    expect(classifyDrop(transfer({ types: ['text/plain'] })).kind).toBe('nothing-usable');
    expect(classifyDrop(transfer({ types: ['text/uri-list'] })).kind).toBe('nothing-usable');
  });

  it('stays quiet when nothing was actually dropped', () => {
    // A drop event carrying neither files nor types is not worth a message;
    // announcing "that did not work" at someone who dropped nothing is noise.
    expect(classifyDrop(transfer()).kind).toBe('empty');
  });

  it('stays quiet when there is no DataTransfer at all', () => {
    expect(classifyDrop(null).kind).toBe('empty');
    expect(classifyDrop(undefined).kind).toBe('empty');
  });
});
