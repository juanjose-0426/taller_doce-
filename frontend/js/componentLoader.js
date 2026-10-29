window.componentLoader = {
  async loadAll() {
    const components = [
      { placeholderId: 'header-slot', url: '/components/header.html' },
      { placeholderId: 'public-view-slot', url: '/components/public-view.html' },
      { placeholderId: 'user-view-slot', url: '/components/user-view.html' },
      { placeholderId: 'staff-view-slot', url: '/components/staff-view.html' },
      { placeholderId: 'admin-view-slot', url: '/components/admin-view.html' },
      { placeholderId: 'notifications-slot', url: '/components/notifications-drawer.html' },
      { placeholderId: 'modals-auth-slot', url: '/components/modals-auth.html' },
      { placeholderId: 'modals-staff-slot', url: '/components/modals-staff.html' },
      { placeholderId: 'modals-admin-slot', url: '/components/modals-admin.html' },
      { placeholderId: 'footer-slot', url: '/components/footer.html' }
    ];

    await Promise.all(components.map(async ({ placeholderId, url }) => {
      const slot = document.getElementById(placeholderId);
      if (slot) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const html = await response.text();
            slot.outerHTML = html;
          } else {
            console.error(`Error cargando componente desde ${url}:`, response.statusText);
          }
        } catch (err) {
          console.error(`Fallo de red cargando componente ${url}:`, err);
        }
      }
    }));
  }
};
