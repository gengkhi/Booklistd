import type { Book } from '@/lib/types';
import {
  applyEdits, canSave, EMPTY_PATCH, formFromBook, isEmptyPatch, needsDetails, toEditPatch, yearError,
} from '../editLogic';

const catalog: Book = {
  id: 'b1', isbn13: '9789710545315', isbn10: null, title: 'Trese', subtitle: null, authors: ['Budjette Tan'],
  publisher: 'Visprint', publishedYear: 2013, edition: null, genres: [], pageCount: null, coverUrl: null,
  description: null, workKey: null, source: 'google',
};
const form = (over: Partial<ReturnType<typeof formFromBook>> = {}) => ({ ...formFromBook(catalog), ...over });

describe('formFromBook', () => {
  it('fills the form from a book, joining authors with commas and blanking nulls', () => {
    expect(formFromBook({ ...catalog, authors: ['A', 'B'] })).toEqual({
      title: 'Trese', authors: 'A, B', subtitle: '', publisher: 'Visprint', year: '2013', edition: '',
    });
  });
});

describe('toEditPatch', () => {
  it('stores nothing when the form matches the catalog', () => {
    expect(toEditPatch(form(), catalog)).toEqual(EMPTY_PATCH);
  });
  it('trims and keeps only changed fields', () => {
    expect(toEditPatch(form({ title: '  Trese: Book of Murders ', edition: ' 2nd ' }), catalog)).toEqual({
      ...EMPTY_PATCH, title: 'Trese: Book of Murders', edition: '2nd',
    });
  });
  it('splits authors on commas and drops empty entries', () => {
    expect(toEditPatch(form({ authors: 'Budjette Tan, , Kajo Baldisimo ,' }), catalog).authors).toEqual(['Budjette Tan', 'Kajo Baldisimo']);
  });
  it('treats an emptied field as "use the catalog value", never as blank', () => {
    const p = toEditPatch(form({ publisher: '   ', authors: '' }), catalog);
    expect(p.publisher).toBeNull();
    expect(p.authors).toBeNull();
  });
  it('never overrides the title with blank', () => {
    expect(toEditPatch(form({ title: '   ' }), catalog).title).toBeNull();
  });
  it('parses the year, and ignores it when invalid', () => {
    expect(toEditPatch(form({ year: '2009' }), catalog).publishedYear).toBe(2009);
    expect(toEditPatch(form({ year: '09' }), catalog).publishedYear).toBeNull();
  });
});

describe('yearError / canSave', () => {
  it('accepts blank or four digits only', () => {
    expect(yearError('')).toBeNull();
    expect(yearError('2013')).toBeNull();
    expect(yearError('213')).toBe('Use a four-digit year, like 2013.');
    expect(yearError('20a3')).toBe('Use a four-digit year, like 2013.');
  });
  it('needs a non-blank title and a valid year', () => {
    expect(canSave(form())).toBe(true);
    expect(canSave(form({ title: '  ' }))).toBe(false);
    expect(canSave(form({ year: '13' }))).toBe(false);
  });
});

describe('isEmptyPatch', () => {
  it('is true only when every field is null', () => {
    expect(isEmptyPatch(EMPTY_PATCH)).toBe(true);
    expect(isEmptyPatch({ ...EMPTY_PATCH, edition: 'x' })).toBe(false);
  });
});

describe('needsDetails', () => {
  it('flags ISBN placeholders and books with no author', () => {
    expect(needsDetails({ title: 'ISBN 9789710545315', authors: [] })).toBe(true);
    expect(needsDetails({ title: 'Trese', authors: [] })).toBe(true);
    expect(needsDetails({ title: 'Trese', authors: ['Budjette Tan'] })).toBe(false);
  });
});

describe('applyEdits', () => {
  it('returns the catalog book untouched (edited: false) when there is no edit', () => {
    expect(applyEdits(catalog, null)).toEqual({ ...catalog, edited: false });
  });
  it('overrides only the fields that are set, and marks the book edited', () => {
    const b = applyEdits(catalog, { ...EMPTY_PATCH, title: 'Trese: Book of Murders', coverPath: null });
    expect(b.title).toBe('Trese: Book of Murders');
    expect(b.authors).toEqual(['Budjette Tan']);
    expect(b.publisher).toBe('Visprint');
    expect(b.edited).toBe(true);
  });
});
