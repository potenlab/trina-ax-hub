// What a person reads when a file operation on the /files page fails. The service throws English messages meant for
// the model (Denied / ToolError); here each one becomes a Korean sentence and a kind. A hidden folder and a missing one
// give the same kind ('hidden') and the same words, so the page never tells them apart.
import { Denied, ToolError } from '../policy/errors'

export type FileErrorKind =
  | 'hidden' | 'read_only' | 'name' | 'unsafe' | 'exists' | 'is_folder' | 'not_empty' | 'protected' | 'rule_folder'
  | 'too_large' | 'binary' | 'invalid' | 'busy' | 'disk' | 'other'

export interface FileError { kind: FileErrorKind; text: string; status: number }

const E = (kind: FileErrorKind, text: string, status: number): FileError => ({ kind, text, status })

export const HIDDEN_TEXT = '찾을 수 없거나 권한이 없는 곳이에요.'

/** The reason a path or name was refused (policy/names.ts, policy/resolve.ts), in Korean. */
function nameProblem(m: string): FileError {
  const bad = (text: string) => E('name', text, 400)
  if (/empty name/.test(m)) return bad('이름이 비어 있어요.')
  if (/name too long|path too long|too deep/.test(m)) return bad('이름이나 경로가 너무 길어요.')
  if (/control characters|invisible|NUL character/.test(m)) return bad('이름에 쓸 수 없는 문자가 들어 있어요.')
  if (/look-alike slash|fullwidth/.test(m)) return bad('슬래시나 전각 문자처럼 보이는 문자는 이름에 쓸 수 없어요.')
  if (/< > : "|backslash/.test(m)) return bad('이름에 \\ / : * ? " < > | 문자는 쓸 수 없어요.')
  if (/end with a dot or a space/.test(m)) return bad('이름 끝에 점이나 빈칸이 있으면 안 돼요.')
  if (/start with a space/.test(m)) return bad('이름 앞에 빈칸이 있으면 안 돼요.')
  if (/reserved device name/.test(m)) return bad('윈도우에서 쓸 수 없는 이름이에요 (CON, NUL, COM1 같은 이름).')
  if (/Windows short names/.test(m)) return bad('ABCDEF~1 같은 윈도우 짧은 이름은 쓸 수 없어요.')
  if (/relative to the team folder|is not allowed|reserved name/.test(m)) return bad('이 경로나 이름은 쓸 수 없어요.')
  return bad('이름이나 경로를 쓸 수 없어요.')
}

export function describeFileError(e: unknown): FileError {
  if (e instanceof Denied) {
    const m = e.message
    if (m.startsWith('not found or no access')) return E('hidden', HIDDEN_TEXT, 404)
    if (m.startsWith('read-only')) return E('read_only', '읽기만 할 수 있는 폴더라서 여기는 바꿀 수 없어요.', 403)
    if (/symbolic link|hard-link|regular file|path changed|resolves outside|not a folder|ambiguous|almost the same name|name not allowed|cannot open folder|disabled/.test(m)) {
      return /almost the same name/.test(m)
        ? E('unsafe', `${m.replace(/^'(.*?)' already exists.*$/, '$1')}과(와) 거의 같은 이름이 이미 있어요. 그 이름을 쓰거나 확실히 다른 이름으로 해 주세요.`, 409)
        : E('unsafe', '이 경로에는 올리거나 바꿀 수 없어요.', 400)
    }
    return nameProblem(m)
  }
  if (e instanceof ToolError) {
    switch (e.code) {
      case 'not_found': return E('hidden', HIDDEN_TEXT, 404)
      case 'exists': return E('exists', '같은 이름이 이미 있어요.', 409)
      case 'is_folder': return E('is_folder', '같은 이름의 폴더가 있어요.', 409)
      case 'not_empty': return E('not_empty', '폴더가 비어 있지 않아요. 안의 파일을 먼저 지우거나 옮겨 주세요.', 409)
      case 'protected': return E('protected', '이 폴더는 이름을 바꾸거나 지울 수 없어요.', 403)
      case 'rule_folder': return E('rule_folder', '이 폴더에는 따로 정한 폴더 권한이 있어서 관리자만 바꿀 수 있어요.', 403)
      case 'too_large': return E('too_large', '파일이 너무 커요.', 413)
      case 'binary': return E('binary', '파일 종류가 달라지는 이름으로는 바꿀 수 없어요. 확장자(.xlsx 같은 끝부분)는 그대로 두세요.', 400)
      case 'invalid': return E('invalid', '이렇게는 할 수 없어요.', 400)
      default: return E('other', '처리하지 못했어요.', 400)
    }
  }
  return E('other', '허브에서 문제가 생겨 처리하지 못했어요. 다시 해 보고, 계속 안 되면 관리자에게 알려 주세요.', 500)
}
