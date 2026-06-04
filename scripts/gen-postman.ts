/* eslint-disable no-console */
/**
 * Sinh file Postman Collection (v2.1) từ toàn bộ NestJS controllers.
 * Chạy: npx ts-node -P tsconfig.json scripts/gen-postman.ts
 * Output: scripts/DA-Nong-Nghiep.postman_collection.json
 *
 * - Base URL: {{baseUrl}} = http://localhost:8000/api/v1
 * - Auth: Bearer {{token}} (login tự lưu token qua test script)
 * - TỰ PARSE DTO của @Body() → sinh body JSON mẫu thật cho MỌI endpoint POST/PATCH/PUT.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../src');
const OUT = path.resolve(__dirname, 'DA-Nong-Nghiep.postman_collection.json');

type Route = { method: string; url: string; name: string; isPublic: boolean; perms?: string; bodyDto?: string; queryDto?: string };

// ─── Index toàn bộ source để resolve DTO + enum ──────────────────────────────
const ALL_TS: string[] = [];
function indexTs(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) indexTs(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) ALL_TS.push(p);
  }
}
indexTs(SRC);
const SRC_CACHE = new Map<string, string>();
function readTs(f: string): string {
  if (!SRC_CACHE.has(f)) SRC_CACHE.set(f, fs.readFileSync(f, 'utf8'));
  return SRC_CACHE.get(f)!;
}

// enum name → first string value
const ENUM_INDEX = new Map<string, string>();
for (const f of ALL_TS) {
  const txt = readTs(f);
  const re = /export\s+enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    const name = m[1];
    const firstVal = m[2].match(/=\s*['"`]([^'"`]+)['"`]/);
    if (firstVal && !ENUM_INDEX.has(name)) ENUM_INDEX.set(name, firstVal[1]);
  }
}

// dto class name → raw class body source
const DTO_INDEX = new Map<string, { body: string; extendsName?: string; file: string }>();
for (const f of ALL_TS) {
  const txt = readTs(f);
  // match: export class XxxDto extends Foo(Bar) {  ...  }
  const re = /export\s+class\s+(\w+)(?:\s+extends\s+([^\{]+))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    const name = m[1];
    const ext = m[2]?.trim();
    // tìm body cân bằng ngoặc
    let depth = 0, i = re.lastIndex - 1, start = re.lastIndex;
    for (; i < txt.length; i++) {
      if (txt[i] === '{') depth++;
      else if (txt[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = txt.slice(start, i);
    // extract parent class name from "PartialType(FooDto)" or "FooDto"
    let extendsName: string | undefined;
    if (ext) {
      const inner = ext.match(/\((\w+)\)/);
      extendsName = inner ? inner[1] : ext.match(/^(\w+)/)?.[1];
    }
    if (!DTO_INDEX.has(name)) DTO_INDEX.set(name, { body, extendsName, file: f });
  }
}

// ─── Sinh sample value cho 1 property ────────────────────────────────────────
function sampleByName(name: string): any | undefined {
  const n = name.toLowerCase();
  if (/email/.test(n)) return 'user@example.com';
  if (/password/.test(n)) return '123456';
  if (/phone|sđt|sdt/.test(n)) return '0900000000';
  if (/uuid/.test(n) || /id$/.test(n)) return '<UUID>';
  // String-ish ưu tiên trước numeric để tránh "discountName" → số
  if (/slug/.test(n)) return 'vi-du-slug';
  if (/code/.test(n)) return 'MA01';
  if (/url|image|avatar|thumbnail|photo/.test(n)) return 'https://example.com/image.jpg';
  if (/desc|note|message|content|reason|address|ghichu/.test(n)) return 'Nội dung mẫu';
  if (/name|title|fullname|tieu_de|ten/.test(n)) return 'Giá trị mẫu';
  if (/(date|expire|start|end|_at$|At$)/.test(n)) return new Date().toISOString();
  // Numeric
  if (/price|cost|amount|value|total|fee|payment|salary|limit/.test(n)) return 100000;
  if (/qty|quantity|stock|count|so_luong|soluong|sort|order_index|position/.test(n)) return 1;
  if (/pct|percent|rate|discount/.test(n)) return 10;
  return undefined;
}

function sampleForProp(propName: string, decorators: string, tsType: string, depth: number): any {
  // enum
  const enumM = decorators.match(/@IsEnum\(\s*(\w+)/);
  if (enumM && ENUM_INDEX.has(enumM[1])) return ENUM_INDEX.get(enumM[1]);
  if (/@IsEmail/.test(decorators)) return 'user@example.com';
  if (/@IsBoolean/.test(decorators) || /:\s*boolean/.test(tsType)) return true;
  if (/@IsDateString|@IsDate/.test(decorators)) return new Date().toISOString();
  if (/@IsUUID/.test(decorators)) return '<UUID>';
  // array
  if (/@IsArray/.test(decorators) || /\[\]/.test(tsType)) {
    const nested = decorators.match(/@Type\(\(\)\s*=>\s*(\w+)\)/);
    if (nested && DTO_INDEX.has(nested[1]) && depth < 3) {
      return [sampleForDto(nested[1], depth + 1)];
    }
    const byName = sampleByName(propName);
    return byName !== undefined ? [byName] : [];
  }
  // nested object DTO
  const nestedObj = decorators.match(/@Type\(\(\)\s*=>\s*(\w+)\)/);
  if (nestedObj && DTO_INDEX.has(nestedObj[1]) && depth < 3) {
    return sampleForDto(nestedObj[1], depth + 1);
  }
  if (/@IsInt|@IsNumber/.test(decorators) || /:\s*number/.test(tsType)) {
    const min = decorators.match(/@Min\(\s*(\d+)/);
    const byName = sampleByName(propName);
    if (typeof byName === 'number') return byName;
    return min ? Number(min[1]) : 0;
  }
  // string fallback
  const byName = sampleByName(propName);
  if (byName !== undefined) return byName;
  return 'string';
}

// dto name → sample object
function sampleForDto(dtoName: string, depth = 0): Record<string, any> {
  const dto = DTO_INDEX.get(dtoName);
  if (!dto) return {};
  const out: Record<string, any> = {};
  // parent fields trước
  if (dto.extendsName && DTO_INDEX.has(dto.extendsName) && depth < 3) {
    Object.assign(out, sampleForDto(dto.extendsName, depth + 1));
  }
  // tách property: tìm các dòng "name(!|?)?: type" có decorator phía trên
  const lines = dto.body.split(/\r?\n/);
  let decoBuf = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) { decoBuf += ' ' + trimmed; continue; }
    const propM = trimmed.match(/^([a-zA-Z_]\w*)\s*[!?]?\s*:\s*([^;=]+)[;=]?/);
    if (propM && !/\(/.test(propM[1])) {
      const propName = propM[1];
      const tsType = propM[2].trim();
      // bỏ qua nếu là method
      if (!/^(constructor|get|set)$/.test(propName)) {
        out[propName] = sampleForProp(propName, decoBuf, tsType, depth);
      }
    }
    decoBuf = '';
  }
  return out;
}

// ─── Parse controller ────────────────────────────────────────────────────────
function joinUrl(base: string, sub: string): string {
  const b = base.replace(/^\/+|\/+$/g, '');
  const s = sub.replace(/^\/+|\/+$/g, '');
  return [b, s].filter(Boolean).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function parseController(file: string): { folder: string; routes: Route[] } {
  const txt = fs.readFileSync(file, 'utf8');
  const ctrlMatch = txt.match(/@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/);
  const base = ctrlMatch?.[1] ?? '';
  const folder = path.basename(file).replace('.controller.ts', '');
  const routes: Route[] = [];
  const lines = txt.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = /@(Get|Post|Patch|Put|Delete)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/.exec(lines[i]);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const sub = m[2] ?? '';
    const ctx = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
    const isPublic = /@Public\s*\(/.test(ctx);
    const permMatch = ctx.match(/@RequirePermissions\(\s*['"`]([^'"`]+)['"`]/);
    const respMatch = ctx.match(/@ResponseMessage\(\s*['"`]([^'"`]+)['"`]/);

    // đọc signature method (tới dấu { hoặc ) {) để tìm @Body()/@Query() type
    const sigBlock = lines.slice(i + 1, i + 14).join('\n');
    const bodyM = sigBlock.match(/@Body\(\)\s*\w+\s*:\s*(\w+)/);
    const queryM = sigBlock.match(/@Query\(\)\s*\w+\s*:\s*(\w+)/);
    let fnName = '';
    const fnM = sigBlock.match(/(?:async\s+)?([a-zA-Z0-9_]+)\s*\(/);
    if (fnM) fnName = fnM[1];

    const url = joinUrl(base, sub);
    const name = respMatch?.[1] ?? `${method} /${url}${fnName ? ' (' + fnName + ')' : ''}`;
    routes.push({ method, url, name, isPublic, perms: permMatch?.[1], bodyDto: bodyM?.[1], queryDto: queryM?.[1] });
  }
  return { folder, routes };
}

// ─── Override cho endpoint đặc biệt (file upload, form login) ─────────────────
const BODY_OVERRIDES: Record<string, any> = {
  'POST auth/login': { __form: { username: 'testadmin', password: '123456' } },
  'POST rice-diagnosis/predict': { __file: 'file' },
  'POST rice-diagnosis/predict/me': { __file: 'file' },
  'POST support-chat/bot/reply': { message: 'Chính sách đổi trả như thế nào?', history: [] },
  'POST support-chat/bot/reply/me': { message: 'Tìm phân NPK giúp tôi', history: [{ role: 'user', content: 'xin chào' }] },
};

function buildItem(r: Route) {
  const key = `${r.method} ${r.url}`;
  const override = BODY_OVERRIDES[key];
  const pathSegments = r.url.split('/').filter(Boolean);

  const req: any = {
    method: r.method,
    header: [],
    url: { raw: `{{baseUrl}}/${r.url}`, host: ['{{baseUrl}}'], path: pathSegments },
  };

  if (!r.isPublic || r.url.includes('/me') || r.url.includes('admin')) {
    req.header.push({ key: 'Authorization', value: 'Bearer {{token}}' });
  }

  // Query string từ DTO (nếu có) — chỉ thêm vài field đầu làm gợi ý
  if (r.method === 'GET' && r.queryDto && DTO_INDEX.has(r.queryDto)) {
    const sample = sampleForDto(r.queryDto);
    const entries = Object.entries(sample).slice(0, 6);
    if (entries.length) {
      req.url.query = entries.map(([k, v]) => ({ key: k, value: String(typeof v === 'object' ? '' : v) }));
      req.url.raw = `{{baseUrl}}/${r.url}?` + entries.map(([k, v]) => `${k}=${typeof v === 'object' ? '' : v}`).join('&');
    }
  }

  if (['POST', 'PATCH', 'PUT'].includes(r.method)) {
    if (override?.__form) {
      req.header.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
      req.body = { mode: 'urlencoded', urlencoded: Object.entries(override.__form).map(([k, v]) => ({ key: k, value: String(v), type: 'text' })) };
    } else if (override?.__file) {
      req.body = { mode: 'formdata', formdata: [{ key: override.__file, type: 'file', src: [] }] };
    } else {
      const bodyObj = override ?? (r.bodyDto ? sampleForDto(r.bodyDto) : {});
      req.header.push({ key: 'Content-Type', value: 'application/json' });
      req.body = { mode: 'raw', raw: JSON.stringify(bodyObj, null, 2), options: { raw: { language: 'json' } } };
    }
  }

  const item: any = { name: r.name, request: req, response: [] };
  if (key === 'POST auth/login') {
    item.event = [{
      listen: 'test',
      script: { type: 'text/javascript', exec: [
        'const res = pm.response.json();',
        'const tok = res?.data?.access_token || res?.access_token;',
        'if (tok) { pm.collectionVariables.set("token", tok); console.log("Saved token"); }',
      ] },
    }];
  }
  return item;
}

function main() {
  const files = walk(SRC).sort();
  const AI_FOLDERS = ['rice-diagnosis', 'intelligence', 'support-chat'];
  const parsed = files.map(parseController).filter((c) => c.routes.length > 0);
  parsed.sort((a, b) => {
    const ai = (x: string) => (AI_FOLDERS.includes(x) ? 0 : 1);
    if (ai(a.folder) !== ai(b.folder)) return ai(a.folder) - ai(b.folder);
    return a.folder.localeCompare(b.folder);
  });

  const folders: any[] = [];
  let total = 0, withBody = 0;
  for (const { folder, routes } of parsed) {
    const isAi = AI_FOLDERS.includes(folder);
    folders.push({ name: `${isAi ? '🤖 ' : ''}${folder}`, item: routes.map(buildItem) });
    total += routes.length;
    withBody += routes.filter((r) => ['POST', 'PATCH', 'PUT'].includes(r.method) && r.bodyDto).length;
  }

  const collection = {
    info: {
      name: 'DA Nông Nghiệp - Full API',
      description: `Tự động sinh từ ${parsed.length} controllers, ${total} endpoints. Body JSON mẫu tự parse từ DTO (${withBody} endpoint có DTO).\n\nHƯỚNG DẪN:\n1. Set {{baseUrl}} (mặc định http://localhost:8000/api/v1).\n2. Chạy "auth > User Login" trước → token tự lưu.\n3. Thay <UUID>, :id bằng giá trị thật từ response GET list.\n\nNHÓM AI (🤖): rice-diagnosis, intelligence, support-chat.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: folders,
    variable: [
      { key: 'baseUrl', value: 'http://localhost:8000/api/v1' },
      { key: 'token', value: '' },
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(collection, null, 2), 'utf8');
  console.log(`✓ Generated ${OUT}`);
  console.log(`  ${parsed.length} folders, ${total} endpoints, ${withBody} có body từ DTO`);
  console.log(`  Indexed: ${DTO_INDEX.size} DTOs, ${ENUM_INDEX.size} enums`);
}

main();
