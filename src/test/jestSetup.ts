/**
 * Global Jest mocks for native modules that many files import transitively.
 * A test that needs different behaviour calls jest.mock() for the same module itself; that wins.
 */
jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual('crypto');
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, data: string) => nodeCrypto.createHash('sha256').update(data).digest('hex'),
  };
});

// The real database is native; tests use freshDb() from src/test/testDb.ts instead.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('Tests must call freshDb() from src/test/testDb.ts');
  },
}));

// Minimal file-system stubs: nothing exists, writes are no-ops. Tests that care mock these themselves.
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    static downloadFileAsync = jest.fn(async (_url: string, dest: File) => dest);
    create() {}
    write() {}
    delete() {}
    copySync() {}
    moveSync() {}
    async bytes() { return new Uint8Array(); }
  }
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}), isAvailableAsync: jest.fn(async () => true) }));
