// Interface text and the messages sent to sessions, per language.
// Pick one with the block's props: { "lang": "zh-TW" }. English is the default.

const en = {
  title: "Decisions",
  all: "All",
  rail: "Decide",
  expand: "Expand",
  restore: "Restore",
  loading: "Loading…",
  empty: (dir) => `Nothing is waiting for you. A session that needs a decision writes a file in its project's ${dir}/.`,
  from: (terminal) => `From ${terminal}`,
  approve: "Approve",
  rejected: "Rejected",
  reject: "Reject…",
  addNote: "+ Note",
  notePlaceholder: "Note, sent to the session with your decision",
  reasonPlaceholder: "Why you reject it. Enter sends",
  sendReject: "Send rejection",
  cancel: "Cancel",
  working: "Working…",
  goToSession: "Go to session",
  notifyAgain: "Notify again",
  copy: "Copy",
  copied: "Copied",
  decidedLine: (label, note) => `Decided: ${label}${note ? ` (${note})` : ""}. Waiting for the session to archive it.`,
  toastTitle: (project) => `Needs your decision · ${project}`,
  readFailed: (why) => `Could not read decisions: ${why}`,
  unreachable: (machine, stale) => `Can't reach ${machine}${stale ? ", showing the last read" : ""}`,
  projectReadFailed: (project, why) => `${project}: read failed (${why})`,
  writeFailed: (why) => `Could not record the decision: ${why}`,
  fileGone: "the decision file no longer exists",
  alreadyDecided: "this was already decided",
  noRequester: "Recorded. The file names no requester, so no session was told.",
  notifyFailed: (terminal, why) => `Recorded, but ${terminal} could not be told: ${why}`,
  notified: (terminal) => `Told ${terminal} again.`,
  sessionMessage: ({ title, rejected, label, note, path, dir }) => {
    const outcome = rejected
      ? `was rejected${note ? `. Reason: ${note}` : ""}. Do not proceed as proposed; adjust to the reason, and write a new decision file if you need another decision`
      : `was decided: ${label}${note ? `. Note: ${note}` : ""}`;
    return `[decisions panel] "${title}" ${outcome}. File: ${path} (the file is the source of truth; move it to ${dir}/done/ when you have handled it)`;
  },
};

const zhTW = {
  title: "待決策",
  all: "全部",
  rail: "決策",
  expand: "放大",
  restore: "縮小",
  loading: "讀取中…",
  empty: (dir) => `目前沒有待決策事項。Session 需要你決定時，會在專案的 ${dir}/ 建立決策檔。`,
  from: (terminal) => `來自 ${terminal}`,
  approve: "核准",
  rejected: "駁回",
  reject: "駁回…",
  addNote: "＋備註",
  notePlaceholder: "備註，會一併送給 session",
  reasonPlaceholder: "駁回原因，Enter 送出",
  sendReject: "送出駁回",
  cancel: "取消",
  working: "處理中…",
  goToSession: "前往 session",
  notifyAgain: "再通知一次",
  copy: "複製",
  copied: "已複製",
  decidedLine: (label, note) => `已決定：${label}${note ? `（${note}）` : ""}，等 session 處理後歸檔`,
  toastTitle: (project) => `需要你決策 · ${project}`,
  readFailed: (why) => `讀取失敗：${why}`,
  unreachable: (machine, stale) => `無法連到 ${machine}${stale ? "，顯示上次讀到的內容" : ""}`,
  projectReadFailed: (project, why) => `${project}：讀取失敗（${why}）`,
  writeFailed: (why) => `無法寫入決策：${why}`,
  fileGone: "決策檔已不存在",
  alreadyDecided: "這項已經決定過了",
  noRequester: "已記錄（決策檔沒有 requester，未通知 session）",
  notifyFailed: (terminal, why) => `已記錄，但通知 ${terminal} 失敗：${why}`,
  notified: (terminal) => `已再次通知 ${terminal}`,
  sessionMessage: ({ title, rejected, label, note, path, dir }) => {
    const outcome = rejected
      ? `已駁回${note ? `。原因：${note}` : ""}。請不要照原提案進行，依駁回原因調整後續做法；需要再次決策就開新的決策檔`
      : `已決定：${label}${note ? `。備註：${note}` : ""}`;
    return `[決策面板] 「${title}」${outcome}。決策檔：${path}（以檔案內容為準；處理完請把檔案移到 ${dir}/done/）`;
  },
};

const LANGUAGES = { en, "zh-TW": zhTW };

/** The text for a language, English when it is unknown or unset. */
export const strings = (lang) => LANGUAGES[lang] ?? en;
