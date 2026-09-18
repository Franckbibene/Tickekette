import { maxSelectable, parseEuros, parseInteger, validateEmail, validateName, validatePassword } from './validation';

describe('maxSelectable : nombre de places sélectionnables', () => {
  it.each([
    // [disponibles, max par commande, déjà choisies ailleurs, attendu]
    [10, 4, 0, 4],
    [2, 4, 0, 2],
    [10, 4, 3, 1],
    [10, 4, 4, 0],
    [10, 4, 6, 0], // jamais négatif
    [0, 4, 0, 0],
  ])('dispo %i, max %i, ailleurs %i → %i', (available, max, elsewhere, expected) => {
    expect(maxSelectable(available, max, elsewhere)).toBe(expected);
  });
});

describe('parseInteger : quantités et quotas', () => {
  it.each([
    ['0', 0, 10, 0],
    ['10', 0, 10, 10],
    ['11', 0, 10, null],
    ['-1', 0, 10, null],
    ['1.5', 0, 10, null],
    ['abc', 0, 10, null],
    ['', 0, 10, null],
    ['1e3', 0, 5000, null],
  ])('%s entre %i et %i → %s', (value, min, max, expected) => {
    expect(parseInteger(value, min, max)).toBe(expected);
  });
});

describe('parseEuros : prix saisis', () => {
  it.each([
    ['12', 1200],
    ['12,50', 1250],
    ['12.5', 1250],
    [' 0 ', 0],
    ['-5', null],
    ['12,555', null],
    ['douze', null],
    ['100001', null],
  ])('%s → %s centimes', (value, expected) => {
    expect(parseEuros(value)).toBe(expected);
  });
});

describe('champs texte', () => {
  it('nom : obligatoire, espaces ignorés, longueur bornée', () => {
    expect(validateName('   ')).toBeDefined();
    expect(validateName('  Léa  ')).toBeUndefined();
    expect(validateName('x'.repeat(121))).toBeDefined();
  });

  it('e-mail : format vérifié', () => {
    expect(validateEmail('lea@exemple.fr')).toBeUndefined();
    expect(validateEmail('lea@exemple')).toBeDefined();
    expect(validateEmail('')).toBeDefined();
    expect(validateEmail('a b@c.fr')).toBeDefined();
  });

  it('mot de passe : 8 caractères minimum, 72 octets maximum', () => {
    expect(validatePassword('1234567')).toBeDefined();
    expect(validatePassword('12345678')).toBeUndefined();
    expect(validatePassword('é'.repeat(37))).toBeDefined();
  });
});
