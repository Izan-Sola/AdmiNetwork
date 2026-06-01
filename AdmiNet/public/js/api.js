export function authHeaders(extra = {}) {
    return {
        'Content-Type': 'application/json',
        'x-auth-token': sessionStorage.getItem('auth_token') || '',
        ...extra
    };
}