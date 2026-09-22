import { csvCell, exportFileName, libraryCsv, type ExportRow } from '../libraryCsv';

const row = (p: Partial<ExportRow> = {}): ExportRow => ({
  title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441172719', status: 'owned', shelf: 'Study',
  readingState: null, startedAt: null, finishedAt: null, rating: null, loanedTo: null, loanedSince: null, ...p,
});

describe('csvCell', () => {
  it('leaves plain text alone', () => expect(csvCell('Dune')).toBe('Dune'));
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('Herbert, Frank')).toBe('"Herbert, Frank"');
    expect(csvCell('The "Best" Book')).toBe('"The ""Best"" Book"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it.each(['=SUM(A1)', '+1', '-1', '@cmd'])('prefixes a formula start %p with a quote', (v) => {
    expect(csvCell(v)).toBe(`'${v}`);
  });
  it('prefixes and quotes together', () => expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'));
  it('writes null as empty', () => expect(csvCell(null)).toBe(''));
});

describe('libraryCsv', () => {
  it('starts with a BOM and the header, and ends lines with CRLF', () => {
    expect(libraryCsv([])).toBe('﻿Title,Authors,ISBN-13,Status,Shelf,Reading,Started,Finished,Rating,On loan to,Loaned since\r\n');
  });
  it('writes one row per copy with readable labels', () => {
    const csv = libraryCsv([
      row({ readingState: 'read', startedAt: '2026-01-02', finishedAt: '2026-02-03', rating: 7, loanedTo: 'Ana', loanedSince: '2026-03-01 10:00:00' }),
    ]);
    expect(csv.split('\r\n')[1]).toBe('Dune,Frank Herbert,9780441172719,At home,Study,Read,2026-01-02,2026-02-03,Forever shelf,Ana,2026-03-01');
  });
  it('labels wishlist copies, unshelved copies and reading-only books', () => {
    const lines = libraryCsv([
      row({ status: 'wishlist', shelf: null }),
      row({ shelf: null }),
      row({ status: null, shelf: null, readingState: 'reading', authors: ['A', 'B'] }),
    ]).split('\r\n');
    expect(lines[1]).toBe('Dune,Frank Herbert,9780441172719,Wishlist,,,,,,,');
    expect(lines[2]).toBe('Dune,Frank Herbert,9780441172719,At home,Unshelved,,,,,,');
    expect(lines[3]).toBe('Dune,A; B,9780441172719,,,Reading,,,,,');
  });
});

describe('exportFileName', () => {
  it('uses the local date', () => expect(exportFileName(new Date(2026, 8, 5, 23, 30))).toBe('booklistd-library-2026-09-05.csv'));
});
