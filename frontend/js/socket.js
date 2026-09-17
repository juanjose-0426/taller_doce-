/**
 * BIBLIOTIEMPODOCE - TIEMPO REAL & SOCKET.IO CON SÍNTESIS DE AUDIO
 */

class SocketService {
  constructor() {
    this.socket = null;
    this.audioCtx = null;
  }

  init() {
    if (typeof io === 'undefined') {
      console.warn('Socket.io no está cargado');
      return;
    }

    this.socket = io();

    this.socket.on('connect', () => {
      const user = window.api.getUser();
      if (user) {
        this.joinUserRoom(user.id);
        if (user.rol === 'funcionario' || user.rol === 'superadmin') {
          this.joinStaffRoom();
        }
      }
    });

    // Eventos en tiempo real
    this.socket.on('pc:updated', (data) => {
      window.dispatchEvent(new CustomEvent('realtime:pc-updated', { detail: data }));
    });

    this.socket.on('queue:updated', () => {
      window.dispatchEvent(new CustomEvent('realtime:queue-updated'));
    });

    this.socket.on('session:alert', (data) => {
      this.playChime(data.type === 'critical' ? 'critical' : 'warning');
      window.showToast(data.message, data.type === 'critical' ? 'error' : 'warning');
      window.dispatchEvent(new CustomEvent('realtime:session-alert', { detail: data }));
    });

    this.socket.on('session:ended', (data) => {
      this.playChime('critical');
      window.showToast(data.message || 'Tu sesión ha finalizado.', 'info');
      window.dispatchEvent(new CustomEvent('realtime:session-ended', { detail: data }));
    });

    this.socket.on('queue:assigned', (data) => {
      this.playChime('success');
      window.showToast(data.message || '¡Tu turno ha llegado! Se te asignó un computador.', 'success');
      window.dispatchEvent(new CustomEvent('realtime:queue-assigned', { detail: data }));
    });

    this.socket.on('queue:pc_available', (data) => {
      const user = window.api.getUser();
      if (user && (user.rol === 'funcionario' || user.rol === 'superadmin')) {
        this.playChime('info');
        window.showToast(`Equipo ${data.pcName} liberado. Siguiente en fila: ${data.nextUserName}`, 'info');
      }
    });

    this.socket.on('config:updated', (data) => {
      window.showToast('La configuración del sistema fue actualizada.', 'info');
      window.dispatchEvent(new CustomEvent('realtime:config-updated', { detail: data }));
    });
  }

  joinUserRoom(userId) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('join:user', { userId });
    }
  }

  joinStaffRoom() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('join:staff');
    }
  }

  /**
   * Generador de campanadas acústicas mediante Web Audio API
   */
  playChime(type = 'info') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'critical') {
        // Alarma urgente de tiempo agotado
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'warning') {
        // Doble campanada sutil
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now); // Mi (E5)
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else if (type === 'success') {
        // Campanada positiva de turno
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.3); // G5
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now);
        osc.stop(now + 0.6);
      } else {
        // Info leve
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      // Audio bloqueado por política de interacción
    }
  }
}

window.socketService = new SocketService();
