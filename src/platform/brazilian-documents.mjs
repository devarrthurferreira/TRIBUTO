export function validCpf(value) {
  if (typeof value !== 'string' || !/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = length => digits.slice(0, length)
    .reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) * 10 % 11 % 10;
  return digits[9] === checksum(9) && digits[10] === checksum(10);
}

const firstCnpjWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const secondCnpjWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function validCnpj(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9]{12}[0-9]{2}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const digits = [...value].map(character => character.charCodeAt(0) - 48);
  const checksum = weights => {
    const rest = weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digits[12] === checksum(firstCnpjWeights) && digits[13] === checksum(secondCnpjWeights);
}

export function validNumericCnpj(value) {
  return typeof value === 'string' && /^\d{14}$/.test(value) && validCnpj(value);
}
