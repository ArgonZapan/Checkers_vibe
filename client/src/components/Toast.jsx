import React from 'react';

/**
 * Toast - Toast notification display
 */
export default function Toast({ toast }) {
  if (!toast) return null;
  
  return (
    <div 
      className={`toast-notification ${toast.type === 'error' ? 'toast-error' : ''}`} 
      role="alert" 
      aria-live="assertive"
    >
      {toast.message || toast}
    </div>
  );
}
