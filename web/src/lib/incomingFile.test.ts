import { describe, expect, it } from 'vitest';
import { identifyFromBytes, resolveNameAndType } from './incomingFile.js';

const bytes = (...values: number[]): Uint8Array => {
  const array = new Uint8Array(16);
  values.forEach((value, index) => (array[index] = value));
  return array;
};

const container = (tag: string): Uint8Array => {
  const array = new Uint8Array(16);
  [...tag].forEach((character, index) => (array[8 + index] = character.charCodeAt(0)));
  return array;
};

describe('identifyFromBytes', () => {
  it('recognises the formats a camera produces', () => {
    expect(identifyFromBytes(bytes(0xff, 0xd8, 0xff))).toEqual({
      type: 'image/jpeg',
      extension: 'jpg',
    });
    expect(identifyFromBytes(bytes(0x89, 0x50, 0x4e, 0x47))?.type).toBe('image/png');
    expect(identifyFromBytes(container('heic'))?.type).toBe('image/heic');
    expect(identifyFromBytes(container('WEBP'))?.type).toBe('image/webp');
  });

  it('returns null rather than guessing', () => {
    expect(identifyFromBytes(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });
});

describe('resolveNameAndType', () => {
  const jpeg = { type: 'image/jpeg', extension: 'jpg' };

  it('leaves a well-formed file alone', () => {
    expect(
      resolveNameAndType(
        { fileName: 'IMG_20260813.jpg', contentType: 'image/jpeg', sniffed: jpeg },
        '2026-08-13-12-44-00',
      ),
    ).toEqual({ fileName: 'IMG_20260813.jpg', contentType: 'image/jpeg' });
  });

  it('gives an extension to a camera file that has none', () => {
    // The allowlist checks the extension, so without this the upload is
    // rejected for a file type the user never chose.
    expect(
      resolveNameAndType({ fileName: '1000012345', contentType: '', sniffed: jpeg }, 'STAMP'),
    ).toEqual({ fileName: '1000012345.jpg', contentType: 'image/jpeg' });
  });

  it('fills in an empty MIME type from the bytes', () => {
    /*
      This is the one that fails as a 403 rather than as a validation error:
      the SAS is signed with the declared content type and Azure compares it
      against the PUT, so an empty one breaks the signature.
    */
    const result = resolveNameAndType(
      { fileName: 'foto.jpg', contentType: '', sniffed: jpeg },
      'STAMP',
    );
    expect(result.contentType).toBe('image/jpeg');
  });

  it('trusts the bytes over a wrong declared type', () => {
    // Android pickers hand back application/octet-stream fairly often.
    const result = resolveNameAndType(
      { fileName: 'photo', contentType: 'application/octet-stream', sniffed: jpeg },
      'STAMP',
    );
    expect(result).toEqual({ fileName: 'photo.jpg', contentType: 'image/jpeg' });
  });

  it('invents a name only when there is none', () => {
    const result = resolveNameAndType({ fileName: '', contentType: '', sniffed: jpeg }, 'STAMP');
    expect(result.fileName).toBe('foto-STAMP.jpg');
  });

  it('falls back to the extension when the bytes are unreadable', () => {
    const result = resolveNameAndType(
      { fileName: 'ritning.pdf', contentType: '', sniffed: null },
      'STAMP',
    );
    expect(result.fileName).toBe('ritning.pdf');
  });
});
