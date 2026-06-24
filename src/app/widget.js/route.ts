import { NextResponse } from "next/server";

export async function GET() {
  const portalUrl = process.env.NEXT_PUBLIC_URL || "https://warranty-care-portal.vercel.app";

  const jsContent = `(function() {
  // Prevent double initialization
  if (window.__WARRANTY_WIDGET_LOADED__) return;
  window.__WARRANTY_WIDGET_LOADED__ = true;

  // 1. Locate current script to extract company ID and portal URL
  var scriptTag = document.currentScript;
  if (!scriptTag) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && (scripts[i].src.indexOf('widget.js') !== -1 || scripts[i].getAttribute('src')?.indexOf('widget.js') !== -1)) {
        scriptTag = scripts[i];
        break;
      }
    }
  }

  var companyId = 'demo-company';
  var portalUrl = '${portalUrl}'; // Injected from server-side env

  if (scriptTag && scriptTag.src) {
    try {
      var url = new URL(scriptTag.src);
      var compParam = url.searchParams.get('company');
      if (compParam) companyId = compParam;
      // Use resolved script URL origin as fallback to handle custom domains
      portalUrl = url.origin || portalUrl;
    } catch (e) {
      console.error('[Widget] Failed to parse script source URL:', e);
    }
  }

  // 2. Fetch company branding
  fetch(portalUrl + '/api/company/branding?id=' + companyId)
    .then(function(res) {
      if (!res.ok) throw new Error('Failed to fetch branding');
      return res.json();
    })
    .then(function(branding) {
      initializeWidget(branding);
    })
    .catch(function(err) {
      console.warn('[Widget] Using default branding due to error:', err);
      initializeWidget({
        name: 'AI Assistant',
        logo: portalUrl + '/logo.png',
        botColor: '#0F3B3D'
      });
    });

  function initializeWidget(branding) {
    var botColor = branding.botColor || '#0F3B3D';
    var logo = branding.logo || (portalUrl + '/logo.png');
    var botName = branding.name || 'AI Assistant';

    // 3. Inject CSS Styles
    var styleTag = document.createElement('style');
    styleTag.textContent = 
      '#warranty-widget-container {' +
      '  position: fixed;' +
      '  bottom: 20px;' +
      '  right: 20px;' +
      '  z-index: 2147483647;' +
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
      '}' +
      '#warranty-widget-bubble {' +
      '  width: 60px;' +
      '  height: 60px;' +
      '  border-radius: 50%;' +
      '  background-color: ' + botColor + ';' +
      '  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);' +
      '  cursor: pointer;' +
      '  display: flex;' +
      '  align-items: center;' +
      '  justify-content: center;' +
      '  transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s ease;' +
      '  border: none;' +
      '  outline: none;' +
      '}' +
      '#warranty-widget-bubble:hover {' +
      '  transform: scale(1.08);' +
      '}' +
      '#warranty-widget-bubble:active {' +
      '  transform: scale(0.92);' +
      '}' +
      '#warranty-widget-bubble svg {' +
      '  width: 26px;' +
      '  height: 26px;' +
      '  fill: #ffffff;' +
      '  transition: transform 0.25s ease;' +
      '}' +
      '#warranty-widget-panel {' +
      '  position: absolute;' +
      '  bottom: 80px;' +
      '  right: 0;' +
      '  width: 380px;' +
      '  height: 600px;' +
      '  max-height: calc(100vh - 120px);' +
      '  max-width: calc(100vw - 40px);' +
      '  background-color: #ffffff;' +
      '  border-radius: 25px;' +
      '  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);' +
      '  border: 1px solid rgba(0, 0, 0, 0.08);' +
      '  overflow: hidden;' +
      '  display: none;' +
      '  flex-direction: column;' +
      '  opacity: 0;' +
      '  transform: translateY(20px) scale(0.95);' +
      '  transform-origin: bottom right;' +
      '  transition: opacity 0.25s ease, transform 0.25s ease, display 0.25s allow-discrete;' +
      '}' +
      '#warranty-widget-panel.open {' +
      '  display: flex;' +
      '  opacity: 1;' +
      '  transform: translateY(0) scale(1);' +
      '}' +
      '#warranty-widget-iframe {' +
      '  width: 100%;' +
      '  height: 100%;' +
      '  border: none;' +
      '  background: #ffffff;' +
      '}' +
      '#warranty-widget-iframe.loaded {' +
      '  opacity: 1;' +
      '}' +
      '#warranty-widget-skeleton {' +
      '  position: absolute;' +
      '  top: 0; left: 0; right: 0; bottom: 0;' +
      '  display: flex;' +
      '  flex-direction: column;' +
      '  align-items: center;' +
      '  justify-content: center;' +
      '  gap: 16px;' +
      '  background: #ffffff;' +
      '  z-index: 2;' +
      '  transition: opacity 0.3s ease;' +
      '}' +
      '#warranty-widget-skeleton.hidden {' +
      '  opacity: 0;' +
      '  pointer-events: none;' +
      '}' +
      '#warranty-widget-skeleton .spinner {' +
      '  width: 36px;' +
      '  height: 36px;' +
      '  border: 3px solid #e5e7eb;' +
      '  border-top-color: ' + botColor + ';' +
      '  border-radius: 50%;' +
      '  animation: ww-spin 0.7s linear infinite;' +
      '}' +
      '#warranty-widget-skeleton .label {' +
      '  font-size: 13px;' +
      '  color: #6b7280;' +
      '  font-weight: 500;' +
      '}' +
      '@keyframes ww-spin {' +
      '  to { transform: rotate(360deg); }' +
      '}' +
      '@media (max-width: 480px) {' +
      '  #warranty-widget-container {' +
      '    bottom: 15px;' +
      '    right: 15px;' +
      '  }' +
      '  #warranty-widget-panel {' +
      '    width: calc(100vw - 30px);' +
      '    height: calc(100vh - 100px);' +
      '    bottom: 75px;' +
      '  }' +
      '}';
    document.head.appendChild(styleTag);

    // 4. Create DOM elements
    var container = document.createElement('div');
    container.id = 'warranty-widget-container';

    // Bubble button
    var bubble = document.createElement('button');
    bubble.id = 'warranty-widget-bubble';
    bubble.setAttribute('aria-label', 'Open chat assistant');
    
    // Chat icon (SVG)
    var chatIcon = 
      '<svg id="warranty-icon-chat" viewBox="0 0 24 24" style="position: absolute;">' +
      '  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>' +
      '</svg>';
    
    // Close icon (SVG)
    var closeIcon = 
      '<svg id="warranty-icon-close" viewBox="0 0 24 24" style="position: absolute; display: none; transform: rotate(-90deg);">' +
      '  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>' +
      '</svg>';

    bubble.innerHTML = chatIcon + closeIcon;

    // Panel
    var panel = document.createElement('div');
    panel.id = 'warranty-widget-panel';

    // Skeleton loading UI shown while iframe loads
    var skeleton = document.createElement('div');
    skeleton.id = 'warranty-widget-skeleton';
    skeleton.innerHTML = '<div class="spinner"></div><div class="label">Loading assistant...</div>';

    // Iframe inside the panel — pass branding as query params to eliminate inner API call
    var iframe = document.createElement('iframe');
    iframe.id = 'warranty-widget-iframe';
    var iframeSrc = portalUrl + '/widget/' + companyId +
      '?botColor=' + encodeURIComponent(botColor) +
      '&botName=' + encodeURIComponent(botName) +
      '&botLogo=' + encodeURIComponent(logo);
    iframe.title = botName + ' Chat Widget';

    // Preload iframe immediately (don't wait for first click)
    iframe.src = iframeSrc;

    // Hide skeleton once iframe content is ready
    iframe.addEventListener('load', function() {
      setTimeout(function() {
        skeleton.classList.add('hidden');
        iframe.classList.add('loaded');
      }, 500);
    });

    panel.appendChild(skeleton);
    panel.appendChild(iframe);
    container.appendChild(panel);
    container.appendChild(bubble);
    document.body.appendChild(container);

    // 5. Setup interaction handlers
    var isOpen = false;

    function toggleWidget() {
      isOpen = !isOpen;
      
      var chatSvg = document.getElementById('warranty-icon-chat');
      var closeSvg = document.getElementById('warranty-icon-close');

      if (isOpen) {
        panel.style.display = 'flex';
        // Force browser layout update
        panel.offsetHeight;
        panel.classList.add('open');
        
        if (chatSvg) {
          chatSvg.style.display = 'none';
        }
        if (closeSvg) {
          closeSvg.style.display = 'block';
          closeSvg.offsetHeight;
          closeSvg.style.transform = 'rotate(0deg)';
        }
      } else {
        panel.classList.remove('open');
        if (chatSvg) {
          chatSvg.style.display = 'block';
        }
        if (closeSvg) {
          closeSvg.style.transform = 'rotate(-90deg)';
          setTimeout(function() {
            if (!isOpen) closeSvg.style.display = 'none';
          }, 200);
        }
        
        // Hide panel completely after CSS transition concludes
        setTimeout(function() {
          if (!isOpen) {
            panel.style.display = 'none';
          }
        }, 250);
      }
    }

    bubble.addEventListener('click', toggleWidget);

    // Support listening to message from inside iframe to close widget
    window.addEventListener('message', function(event) {
      if (event.origin !== portalUrl) return;
      if (event.data && event.data.type === 'close-widget') {
        if (isOpen) {
          toggleWidget();
        }
      }
    });
  }
})();`;

  return new NextResponse(jsContent, {
    headers: {
      "Content-Type": "application/javascript",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
