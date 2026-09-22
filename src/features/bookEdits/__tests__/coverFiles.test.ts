jest.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///docs/' } }, File: jest.fn(), Directory: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

import { File } from 'expo-file-system';
import { coverFileName, renameCoverFile, resolveCoverUri } from '../coverFiles';

describe('coverFileName', () => {
  it('puts covers in covers/ with the book id and a timestamp', () => {
    expect(coverFileName('b1', 1700000000000)).toBe('covers/b1-1700000000000.jpg');
  });
  it('strips characters that are unsafe in file names', () => {
    expect(coverFileName('a/b:c', 5)).toBe('covers/a_b_c-5.jpg');
  });
});

describe('resolveCoverUri', () => {
  it('joins a relative cover path onto the documents directory', () => {
    expect(resolveCoverUri('covers/b1-5.jpg', 'file:///docs/')).toBe('file:///docs/covers/b1-5.jpg');
  });
  it('tolerates a documents URI without a trailing slash', () => {
    expect(resolveCoverUri('covers/b1-5.jpg', 'file:///docs')).toBe('file:///docs/covers/b1-5.jpg');
  });
  it('returns null when there is no cover path', () => {
    expect(resolveCoverUri(null, 'file:///docs/')).toBeNull();
  });
});

describe('renameCoverFile', () => {
  const moveSync = jest.fn();
  function files(exists: boolean) {
    jest.mocked(File).mockImplementation(((_dir: unknown, rel: string) => ({ uri: rel, exists, moveSync })) as never);
  }
  beforeEach(() => moveSync.mockReset());

  it('moves the photo to a name with the new book id and returns the new path', () => {
    files(true);
    const out = renameCoverFile('covers/old-1.jpg', 'srv');
    expect(out).toMatch(/^covers\/srv-\d+\.jpg$/);
    expect(moveSync).toHaveBeenCalledWith(expect.objectContaining({ uri: out }));
  });
  it('returns null when the photo is missing', () => {
    files(false);
    expect(renameCoverFile('covers/old-1.jpg', 'srv')).toBeNull();
    expect(moveSync).not.toHaveBeenCalled();
  });
  it('returns null when the move fails', () => {
    files(true);
    moveSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(renameCoverFile('covers/old-1.jpg', 'srv')).toBeNull();
  });
});
