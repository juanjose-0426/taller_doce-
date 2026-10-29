const API_BASE = '/api';

const api = {
  getToken() {
    return localStorage.getItem('bt_token');
  },

  setToken(token) {
    localStorage.setItem('bt_token', token);
  },

  getUser() {
    try {
      const u = localStorage.getItem('bt_user');
      if (!u) return null;
      const parsed = JSON.parse(u);
      if (parsed) {
        parsed.rol = parsed.rol || parsed.rol_nombre;
        parsed.rol_nombre = parsed.rol_nombre || parsed.rol;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      user.rol = user.rol || user.rol_nombre;
      user.rol_nombre = user.rol_nombre || user.rol;
    }
    localStorage.setItem('bt_user', JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem('bt_token');
    localStorage.removeItem('bt_user');
  },

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers
      });

      const data = await res.json();

      if (res.status === 401) {
        this.clearSession();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }

      return data;
    } catch (err) {
      console.error(`Error en API [${endpoint}]:`, err);
      return { success: false, message: 'Error de conexión con el servidor.' };
    }
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  patch(endpoint, body) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

window.api = api;
