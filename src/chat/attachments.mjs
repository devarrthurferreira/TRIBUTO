import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/validation.mjs';

const FILE_BYTES = 2 * 1024 * 1024;
const TOTAL_BYTES = 5 * 1024 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const binary = (bytes, signature, offset = 0) => bytes.subarray(offset, offset + signature.length).equals(signature);
const ascii = (bytes, signature, offset) => binary(bytes, Buffer.from(signature), offset);
const zip = (bytes, path) => ascii(bytes, 'PK\x03\x04') && bytes.includes(Buffer.from('[Content_Types].xml'))
  && bytes.includes(Buffer.from(path)) && !bytes.includes(Buffer.from('vbaProject.bin'));
const text = (bytes) => {
  try { return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(textDecoder.decode(bytes)); }
  catch { return false; }
};
const types = new Map([
  ['pdf', ['application/pdf', bytes => ascii(bytes, '%PDF-')]],
  ['png', ['image/png', bytes => binary(bytes, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))]],
  ['jpg', ['image/jpeg', bytes => binary(bytes, Buffer.from([255, 216, 255]))]],
  ['jpeg', ['image/jpeg', bytes => binary(bytes, Buffer.from([255, 216, 255]))]],
  ['gif', ['image/gif', bytes => ascii(bytes, 'GIF87a') || ascii(bytes, 'GIF89a')]],
  ['webp', ['image/webp', bytes => ascii(bytes, 'RIFF') && ascii(bytes, 'WEBP', 8)]],
  ['txt', ['text/plain', text]],
  ['csv', ['text/csv', text]],
  ['docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes => zip(bytes, 'word/document.xml')]],
  ['xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes => zip(bytes, 'xl/workbook.xml')]],
  ['pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes => zip(bytes, 'ppt/presentation.xml')]],
]);

export function normalizeAttachments(files) {
  if (files === undefined) return [];
  if (!Array.isArray(files) || files.length > 3) throw new ApiError(400, 'CHAT_ATTACHMENT_COUNT', 'Anexe até 3 arquivos por mensagem.');
  let total = 0;
  return files.map((file) => {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    const data = file?.data;
    if (!name || name.length > 180 || /[/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name) || !Buffer.isBuffer(data) || !data.length) {
      throw new ApiError(400, 'CHAT_ATTACHMENT_INVALID', 'Anexo inválido.');
    }
    total += data.length;
    if (data.length > FILE_BYTES || total > TOTAL_BYTES) {
      throw new ApiError(413, 'CHAT_ATTACHMENT_SIZE', 'Use até 2 MB por arquivo e 5 MB por mensagem.');
    }
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const type = name.includes('.') ? types.get(ext) : null;
    if (!type || !type[1](data)) throw new ApiError(400, 'CHAT_ATTACHMENT_TYPE', 'Formato de anexo não permitido ou incompatível com o arquivo.');
    return { id: randomUUID(), name, mime: type[0], size: data.length, data };
  });
}

export function sendAttachment(res, file, head) {
  const filename = encodeURIComponent(file.name.toWellFormed()).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': file.size,
    'content-disposition': `attachment; filename="anexo"; filename*=UTF-8''${filename}`,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin'
  });
  res.end(head ? undefined : file.data);
  return true;
}
