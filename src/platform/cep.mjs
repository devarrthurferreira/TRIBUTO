import { ApiError } from '../api/validation.mjs';

export async function lookupCep(cep, fetcher = fetch) {
  if (typeof cep !== 'string' || !/^\d{8}$/.test(cep)) {
    throw new ApiError(400, 'INVALID_CEP', 'Informe um CEP com oito dígitos.');
  }

  let address;
  try {
    const response = await fetcher(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('CEP não consultado');
    address = await response.json();
  } catch {
    throw new ApiError(503, 'CEP_UNAVAILABLE', 'A consulta de CEP está indisponível. Preencha o endereço manualmente.');
  }
  if (address?.erro) throw new ApiError(404, 'CEP_NOT_FOUND', 'CEP não encontrado. Confira os dígitos ou preencha o endereço manualmente.');
  if (typeof address?.logradouro !== 'string' || typeof address.bairro !== 'string') {
    throw new ApiError(503, 'CEP_UNAVAILABLE', 'A consulta de CEP está indisponível. Preencha o endereço manualmente.');
  }
  return { cep, street: address.logradouro.trim().slice(0, 160), neighborhood: address.bairro.trim().slice(0, 100) };
}
