import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      return (
        <div className="page-shell page-shell--center" style={{ padding: '2rem', textAlign: 'center' }}>
          <div className="card-panel" style={{ maxWidth: '640px', margin: '2rem auto', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--color-text, #1e293b)' }}>
              حدث خطأ غير متوقع في عرض هذه الصفحة
            </h2>
            <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              An unexpected error occurred while displaying this page.
            </p>
            {this.state.error?.message && (
              <pre
                style={{
                  background: 'var(--color-surface-muted, #f8fafc)',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  color: '#dc2626',
                  textAlign: 'left',
                  overflowX: 'auto',
                  border: '1px solid rgba(220, 38, 38, 0.2)',
                  marginBottom: '1.5rem',
                  fontFamily: 'monospace',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={this.handleReset}
              >
                🔄 إعادة تحميل الصفحة / Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

