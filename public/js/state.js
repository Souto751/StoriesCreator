import { get } from './api.js';
import { toast } from './ui.js';

export const state = {
  session: null,
  brand: null,
  fonts: [],
  reboot: () => location.reload(),
  navigate: () => {},
  unsaved: false,
};

export async function loadBrand() {
  const data = await get('/api/brand');
  state.brand = data.brand;
  state.fonts = data.fonts;
  return data.brand;
}

// Ejecuta una acción y muestra el error; si la sesión venció, vuelve al login.
export async function run(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) {
      toast('Tu sesión venció. Ingresá de nuevo.', 'error');
      state.unsaved = false;
      state.reboot();
      return undefined;
    }
    toast(err.message || 'Ocurrió un error.', 'error');
    return undefined;
  }
}
