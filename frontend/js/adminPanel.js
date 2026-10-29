const adminPanel = {
  initialized: false,
  charts: {
    demanda: null,
    usoPcs: null,
    semanal: null
  },

  async init() {
    if (!this.initialized) {
      this.setupTabs();
      this.setupForms();
      this.initialized = true;
    }
    await this.loadKPIs();
    await this.loadCharts();
    await this.loadPCsTable();
    await this.loadUsersTable();
    await this.loadConfig();
    await this.loadAuditLogs();
    await this.loadReports();
  },

  setupTabs() {
    const tabButtons = document.querySelectorAll('.admin-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        tabButtons.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));

        e.currentTarget.classList.add('active');
        const panel = document.getElementById(targetTab);
        if (panel) panel.classList.add('active');

        if (targetTab === 'tab-admin-dashboard') {
          this.loadCharts();
        }
      });
    });
  },

  setupForms() {
    const pcForm = document.getElementById('adminPcForm');
    if (pcForm) {
      pcForm.addEventListener('submit', (e) => this.handleSavePC(e));
    }

    const userForm = document.getElementById('adminUserForm');
    if (userForm) {
      userForm.addEventListener('submit', (e) => this.handleSaveUser(e));
    }

    const configForm = document.getElementById('adminConfigForm');
    if (configForm) {
      configForm.addEventListener('submit', (e) => this.handleSaveConfig(e));
    }

    const reportFilterBtn = document.getElementById('adminFilterReportsBtn');
    if (reportFilterBtn) {
      reportFilterBtn.addEventListener('click', () => this.loadReports());
    }

    const exportCsvBtn = document.getElementById('adminExportCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportReportsCSV());
    }
  },

  async loadKPIs() {
    const res = await window.api.get('/admin/kpis');
    if (!res.success) return;

    const d = res.data;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('adminKpiTotalPcs', d.totalComputadores);
    setTxt('adminKpiDispPcs', d.computadoresDisponibles);
    setTxt('adminKpiOcupPcs', d.computadoresOcupados);
    setTxt('adminKpiMantPcs', d.computadoresMantenimiento);
    setTxt('adminKpiTotalUsers', d.totalUsuarios);
    setTxt('adminKpiActiveSessions', d.sesionesActivas);
    setTxt('adminKpiQueue', d.enColaEspera);
    setTxt('adminKpiAvgMinutes', `${d.tiempoPromedioMinutos} min`);
  },

  async loadCharts() {
    if (typeof Chart === 'undefined') return;

    const res = await window.api.get('/admin/statistics');
    if (!res.success) return;

    const data = res.data;

    const ctxDemanda = document.getElementById('chartDemandaHoras');
    if (ctxDemanda) {
      if (this.charts.demanda) this.charts.demanda.destroy();
      this.charts.demanda = new Chart(ctxDemanda, {
        type: 'bar',
        data: {
          labels: data.horariosDemanda.labels,
          datasets: [{
            label: 'Sesiones iniciadas',
            data: data.horariosDemanda.values,
            backgroundColor: 'rgba(3, 105, 161, 0.75)',
            borderColor: '#0369a1',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(15, 23, 42, 0.08)' } },
            x: { grid: { display: false } }
          }
        }
      });
    }

    const ctxPcs = document.getElementById('chartUsoPcs');
    if (ctxPcs) {
      if (this.charts.usoPcs) this.charts.usoPcs.destroy();
      const labels = data.masUtilizados.map(p => p.nombre);
      const values = data.masUtilizados.map(p => p.total_sesiones);

      this.charts.usoPcs = new Chart(ctxPcs, {
        type: 'bar',
        data: {
          labels: labels.length > 0 ? labels : ['Sin datos'],
          datasets: [{
            label: 'Total de sesiones',
            data: values.length > 0 ? values : [0],
            backgroundColor: 'rgba(13, 148, 136, 0.75)',
            borderColor: '#0d9488',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(15, 23, 42, 0.08)' } },
            y: { grid: { display: false } }
          }
        }
      });
    }

    const ctxSemanal = document.getElementById('chartUsoSemanal');
    if (ctxSemanal) {
      if (this.charts.semanal) this.charts.semanal.destroy();
      const labels = data.usoSemanal.map(d => d.dia);
      const values = data.usoSemanal.map(d => d.total);

      this.charts.semanal = new Chart(ctxSemanal, {
        type: 'line',
        data: {
          labels: labels.length > 0 ? labels : ['Hoy'],
          datasets: [{
            label: 'Sesiones por día',
            data: values.length > 0 ? values : [0],
            borderColor: '#059669',
            backgroundColor: 'rgba(5, 150, 105, 0.15)',
            tension: 0.3,
            fill: true,
            pointBackgroundColor: '#059669'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(15, 23, 42, 0.08)' } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  },

  async loadPCsTable() {
    const res = await window.api.get('/pcs');
    const tbody = document.getElementById('adminPcTableBody');
    if (!tbody) return;

    if (res.success && res.data.length > 0) {
      tbody.innerHTML = res.data.map(pc => `
        <tr>
          <td><strong>${pc.numero}</strong></td>
          <td><strong>${pc.nombre}</strong></td>
          <td>${pc.ubicacion}</td>
          <td><span class="status-badge ${pc.estado}">${pc.estado.replace('_', ' ')}</span></td>
          <td style="font-size: 0.78rem; color: var(--text-muted);">${pc.especificaciones || 'Estándar'}</td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-secondary btn-sm" onclick="adminPanel.openEditPCModal(${JSON.stringify(pc).replace(/"/g, '&quot;')})">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn btn-danger btn-sm" onclick="adminPanel.deletePC(${pc.id}, '${pc.nombre}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No hay computadores registrados.</td></tr>';
    }
  },

  openNewPCModal() {
    document.getElementById('adminPcId').value = '';
    document.getElementById('adminPcNombre').value = '';
    document.getElementById('adminPcNumero').value = '';
    document.getElementById('adminPcUbicacion').value = 'Sala General';
    document.getElementById('adminPcSpecs').value = '';
    document.getElementById('adminPcModalTitle').textContent = 'Registrar Nuevo Computador';
    window.showModal('adminPcModal');
  },

  openEditPCModal(pc) {
    document.getElementById('adminPcId').value = pc.id;
    document.getElementById('adminPcNombre').value = pc.nombre;
    document.getElementById('adminPcNumero').value = pc.numero;
    document.getElementById('adminPcUbicacion').value = pc.ubicacion;
    document.getElementById('adminPcSpecs').value = pc.especificaciones || '';
    document.getElementById('adminPcModalTitle').textContent = `Editar ${pc.nombre}`;
    window.showModal('adminPcModal');
  },

  async handleSavePC(e) {
    e.preventDefault();
    const id = document.getElementById('adminPcId').value;
    const nombre = document.getElementById('adminPcNombre').value.trim();
    const numero = document.getElementById('adminPcNumero').value.trim();
    const ubicacion = document.getElementById('adminPcUbicacion').value.trim();
    const especificaciones = document.getElementById('adminPcSpecs').value.trim();

    if (!nombre || !numero || !ubicacion) {
      window.showToast('Por favor completa todos los campos requeridos.', 'warning');
      return;
    }

    let res;
    if (id) {
      res = await window.api.put(`/pcs/${id}`, { nombre, numero, ubicacion, especificaciones });
    } else {
      res = await window.api.post('/pcs', { nombre, numero, ubicacion, especificaciones });
    }

    if (res.success) {
      window.showToast(res.message, 'success');
      window.hideModal('adminPcModal');
      await this.loadPCsTable();
      await this.loadKPIs();
    } else {
      window.showToast(res.message || 'Error al guardar computador.', 'error');
    }
  },

  async deletePC(id, nombre) {
    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente el computador ${nombre}?`)) return;

    const res = await window.api.delete(`/pcs/${id}`);
    if (res.success) {
      window.showToast(res.message, 'success');
      await this.loadPCsTable();
      await this.loadKPIs();
    } else {
      window.showToast(res.message || 'Error al eliminar computador.', 'error');
    }
  },

  async loadUsersTable() {
    const busqueda = document.getElementById('adminUserSearch') ? document.getElementById('adminUserSearch').value.trim() : '';
    const res = await window.api.get(`/admin/users?busqueda=${encodeURIComponent(busqueda)}`);
    const tbody = document.getElementById('adminUserTableBody');
    if (!tbody) return;

    if (res.success && res.data.length > 0) {
      tbody.innerHTML = res.data.map(u => `
        <tr>
          <td><strong>${u.nombre_completo}</strong></td>
          <td>${u.documento}</td>
          <td>${u.correo}</td>
          <td>
            <span class="status-badge ${u.rol_nombre === 'superadmin' ? 'proximo_terminar' : u.rol_nombre === 'funcionario' ? 'ocupado' : 'disponible'}">
              ${u.rol_nombre}
            </span>
          </td>
          <td>
            <span class="status-badge ${u.estado === 'activo' ? 'disponible' : 'fuera_servicio'}">
              ${u.estado}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-secondary btn-sm" title="Editar usuario" onclick="adminPanel.openEditUserModal(${JSON.stringify(u).replace(/"/g, '&quot;')})">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn ${u.estado === 'activo' ? 'btn-danger' : 'btn-success'} btn-sm" title="${u.estado === 'activo' ? 'Desactivar' : 'Activar'}" onclick="adminPanel.toggleUserStatus(${u.id})">
                <i class="fas ${u.estado === 'activo' ? 'fa-user-slash' : 'fa-user-check'}"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No se encontraron usuarios.</td></tr>';
    }
  },

  openNewUserModal() {
    document.getElementById('adminUserId').value = '';
    document.getElementById('adminUserNombre').value = '';
    document.getElementById('adminUserDoc').value = '';
    document.getElementById('adminUserCorreo').value = '';
    document.getElementById('adminUserPass').value = '';
    document.getElementById('adminUserPass').required = true;
    document.getElementById('adminUserRol').value = '3';
    document.getElementById('adminUserModalTitle').textContent = 'Crear Nuevo Usuario';
    window.showModal('adminUserModal');
  },

  openEditUserModal(u) {
    document.getElementById('adminUserId').value = u.id;
    document.getElementById('adminUserNombre').value = u.nombre_completo;
    document.getElementById('adminUserDoc').value = u.documento;
    document.getElementById('adminUserCorreo').value = u.correo;
    document.getElementById('adminUserPass').value = '';
    document.getElementById('adminUserPass').required = false;
    document.getElementById('adminUserRol').value = u.rol_id;
    document.getElementById('adminUserModalTitle').textContent = `Editar a ${u.nombre_completo}`;
    window.showModal('adminUserModal');
  },

  async handleSaveUser(e) {
    e.preventDefault();
    const id = document.getElementById('adminUserId').value;
    const nombre_completo = document.getElementById('adminUserNombre').value.trim();
    const documento = document.getElementById('adminUserDoc').value.trim();
    const correo = document.getElementById('adminUserCorreo').value.trim();
    const password = document.getElementById('adminUserPass').value.trim();
    const rol_id = document.getElementById('adminUserRol').value;

    let res;
    if (id) {
      res = await window.api.put(`/admin/users/${id}`, {
        nombre_completo,
        documento,
        correo,
        rol_id,
        nueva_password: password
      });
    } else {
      res = await window.api.post('/admin/users', {
        nombre_completo,
        documento,
        correo,
        password,
        rol_id
      });
    }

    if (res.success) {
      window.showToast(res.message, 'success');
      window.hideModal('adminUserModal');
      await this.loadUsersTable();
      await this.loadKPIs();
    } else {
      window.showToast(res.message || 'Error al guardar usuario.', 'error');
    }
  },

  async toggleUserStatus(id) {
    const res = await window.api.patch(`/admin/users/${id}/toggle-status`);
    if (res.success) {
      window.showToast(res.message, 'info');
      await this.loadUsersTable();
    } else {
      window.showToast(res.message || 'Error al actualizar estado del usuario.', 'error');
    }
  },

  async loadConfig() {
    const res = await window.api.get('/admin/config');
    if (res.success) {
      const cfg = res.data;
      const elMax = document.getElementById('configTiempoMaximo');
      const elAlert = document.getElementById('configTiempoAlerta');
      const elRules = document.getElementById('configReglasEspera');
      const elAction = document.getElementById('configAccionFin');

      if (elMax) elMax.value = cfg.tiempo_maximo;
      if (elAlert) elAlert.value = cfg.tiempo_alerta;
      if (elRules) elRules.value = cfg.reglas_lista_espera || '';
      if (elAction) elAction.value = cfg.accion_fin_tiempo || 'finalizar_automatica';
    }
  },

  async handleSaveConfig(e) {
    e.preventDefault();
    const tiempo_maximo = document.getElementById('configTiempoMaximo').value;
    const tiempo_alerta = document.getElementById('configTiempoAlerta').value;
    const reglas_lista_espera = document.getElementById('configReglasEspera').value.trim();
    const accion_fin_tiempo = document.getElementById('configAccionFin').value;

    const res = await window.api.put('/admin/config', {
      tiempo_maximo,
      tiempo_alerta,
      reglas_lista_espera,
      accion_fin_tiempo
    });

    if (res.success) {
      window.showToast(res.message, 'success');
    } else {
      window.showToast(res.message || 'Error al guardar configuración.', 'error');
    }
  },

  async loadAuditLogs() {
    const res = await window.api.get('/admin/audit-logs?limit=50');
    const tbody = document.getElementById('adminAuditTableBody');
    if (!tbody) return;

    if (res.success && res.data.length > 0) {
      tbody.innerHTML = res.data.map(log => {
        const fecha = new Date(log.fecha).toLocaleString();
        return `
          <tr>
            <td style="font-size: 0.78rem; color: var(--text-muted);">${fecha}</td>
            <td><strong>${log.usuario_nombre || 'Sistema'}</strong></td>
            <td><span class="badge" style="font-family: monospace; font-size: 0.75rem;">${log.accion}</span></td>
            <td style="font-size: 0.82rem;">${log.descripcion}</td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No hay registros de auditoría aún.</td></tr>';
    }
  },

  currentReportData: [],

  async loadReports() {
    const fecha_inicio = document.getElementById('reportFechaInicio') ? document.getElementById('reportFechaInicio').value : '';
    const fecha_fin = document.getElementById('reportFechaFin') ? document.getElementById('reportFechaFin').value : '';

    const queryParams = new URLSearchParams();
    if (fecha_inicio) queryParams.append('fecha_inicio', fecha_inicio);
    if (fecha_fin) queryParams.append('fecha_fin', fecha_fin);

    const res = await window.api.get(`/admin/reports?${queryParams.toString()}`);
    const tbody = document.getElementById('adminReportsTableBody');
    if (!tbody) return;

    if (res.success) {
      this.currentReportData = res.data;

      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setTxt('reportTotalSesiones', res.resumen.totalSesiones);
      setTxt('reportTotalHoras', `${res.resumen.totalHoras} h`);
      setTxt('reportPromedioMin', `${res.resumen.promedioMinutos} min`);

      if (res.data.length > 0) {
        tbody.innerHTML = res.data.map(r => {
          const inicio = new Date(r.fecha_inicio).toLocaleString();
          const duracionMin = r.tiempo_utilizado ? Math.round(r.tiempo_utilizado / 60) : r.tiempo_maximo;
          return `
            <tr>
              <td><strong>${r.pc_nombre}</strong> (${r.pc_ubicacion})</td>
              <td>${r.usuario_nombre}</td>
              <td>${r.usuario_documento}</td>
              <td>${inicio}</td>
              <td><strong>${duracionMin} min</strong></td>
              <td><span class="status-badge ${r.estado === 'finalizada' ? 'disponible' : 'ocupado'}">${r.estado}</span></td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">No se encontraron registros para los filtros seleccionados.</td></tr>';
      }
    }
  },

  exportReportsCSV() {
    if (!this.currentReportData || this.currentReportData.length === 0) {
      window.showToast('No hay datos para exportar.', 'warning');
      return;
    }

    const headers = ['Computador', 'Ubicacion', 'Usuario', 'Documento', 'Fecha_Inicio', 'Duracion_Minutos', 'Estado'];
    const rows = this.currentReportData.map(r => [
      `"${r.pc_nombre}"`,
      `"${r.pc_ubicacion}"`,
      `"${r.usuario_nombre}"`,
      `"${r.usuario_documento}"`,
      `"${new Date(r.fecha_inicio).toLocaleString()}"`,
      r.tiempo_utilizado ? Math.round(r.tiempo_utilizado / 60) : r.tiempo_maximo,
      `"${r.estado}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF'
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reporte_sesiones_bibliotiempo_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.showToast('Reporte CSV generado y descargado.', 'success');
  }
};

window.adminPanel = adminPanel;
