import { parseRouteId, safeExternalUrl, safeInternalPath } from './url';

describe('safeInternalPath : pas de redirection ouverte', () => {
  it.each([
    ['/admin', '/admin'],
    ['/commande/abc', '/commande/abc'],
    ['//site-pirate.com', '/'],
    ['/\\site-pirate.com', '/'],
    ['https://site-pirate.com', '/'],
    ['javascript:alert(1)', '/'],
    [42, '/'],
    [undefined, '/'],
  ])('%s → %s', (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
  });
});

describe('safeExternalUrl : protocoles autorisés', () => {
  it('accepte http et https', () => {
    expect(safeExternalUrl('https://live.exemple.fr/x')).toBe('https://live.exemple.fr/x');
    expect(safeExternalUrl('http://exemple.fr')).toBe('http://exemple.fr/');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'pas une url', null])('refuse %s', (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });
});

describe('parseRouteId', () => {
  it.each([
    ['12', 12],
    ['0', null],
    ['-1', null],
    ['12abc', null],
    ['1;DROP', null],
    [undefined, null],
    ['99999999999', null],
  ])('%s → %s', (value, expected) => {
    expect(parseRouteId(value)).toBe(expected);
  });
});
