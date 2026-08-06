let token: string | null = null;

/** 校验 AuthCode 只能包含 ASCII 字符（HTTP header 限制） */
export const isValidAuthCode = (code: string) =>
  /^[\x00-\x7F]+$/.test(code);

export const getAuthCode = () => {
  if (token !== null) {
    return token;
  }

  token = window.localStorage.getItem('authCode');
  return token;
};

export const setAuthCode = (authCode: string | null) => {
  if (authCode && !isValidAuthCode(authCode)) {
    console.error('AuthCode 只能包含 ASCII 字符（字母/数字/符号），已拒绝保存');
    return false;
  }
  token = authCode;
  if (!authCode) {
    window.localStorage.removeItem('authCode');
    return true;
  }
  window.localStorage.setItem('authCode', authCode);
  return true;
};
