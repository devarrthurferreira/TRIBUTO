export const CLIENT_REGIMES = new Map([
  ['indefinido', 'Indefinido'], ['cei', 'CEI'], ['domestica', 'Doméstica'], ['imune-isenta', 'Imune - Isenta'],
  ['lucro-presumido', 'Lucro Presumido'], ['lucro-real', 'Lucro Real'], ['mei', 'MEI'],
  ['pessoa-fisica-cno', 'Pessoa Física CNO'], ['produtor-rural', 'Produtor rural'],
  ['simples-nacional-puro', 'Simples Nacional Puro'], ['simples-nacional-regular', 'Simples Nacional Regular'],
  ['simples-nacional', 'Simples Nacional'], ['lucro-arbitrado', 'Lucro Arbitrado'], ['outro', 'Outro'],
]);

export function formatCaepf(digits) {
  return digits.slice(0, 14).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3}\.\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d)/, '$1/$2').replace(/(\/\d{3})(\d)/, '$1-$2');
}

export function validCaepf(digits) {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  function checkDigit(base) {
    const sum = [...base].reduce((total, digit, i) => total + Number(digit) * (2 + (base.length - 1 - i) % 8), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  }
  const base = digits.slice(0, 12);
  const first = checkDigit(base);
  const second = checkDigit(base + first);
  return Number(digits.slice(-2)) === (first * 10 + second + 12) % 100;
}
