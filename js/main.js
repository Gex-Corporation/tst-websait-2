document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/cards');
    if (!res.ok) throw new Error('Failed to fetch cards');
    const cards = await res.json();
    
    cards.forEach(card => {
      // Find the target container for this section
      let container = document.querySelector(`#${card.section_id} .grid`);
      if (!container) container = document.querySelector(`#${card.section_id} .modal-grid`); // fallback for paid sensi modal
      
      if (container) {
        // Construct the dynamic card HTML
        const accent = card.accent_color || 'purple';
        const isPrimaryBtn = card.button_type === 'primary';
        
        const cardHTML = `
          <div class="card" data-accent="${accent}">
            <div class="card__head">
              <div class="card__icon">
                <img src="${card.logo_url || 'assets/msi.logo.png'}" alt="${card.title}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px;">
              </div>
              <h3 class="card__title">${card.title}</h3>
              ${card.badge_text ? `<span class="card__badge">${card.badge_text}</span>` : ''}
            </div>
            <div class="card__body" style="padding: 1rem 1.5rem; color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5;">
              ${card.description ? card.description.replace(/\n/g, '<br/>') : ''}
            </div>
            <a href="${card.download_link || '#'}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block; margin-top: auto;">
              <button class="btn ${isPrimaryBtn ? 'btn--primary' : 'btn--secondary'} btn--download" style="width: 100%;">
                <svg class="btn__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                ${card.button_text || 'Download'}
              </button>
            </a>
          </div>
        `;
        
        container.insertAdjacentHTML('beforeend', cardHTML);
      }
    });
  } catch (e) {
    console.error("Failed to load dynamic cards:", e);
  }

  // Dynamic cards are handled by main.js, page navigation and toggle are handled by script.js
});
