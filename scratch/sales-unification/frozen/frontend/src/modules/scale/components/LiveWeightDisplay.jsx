import React from 'react';
import { useI18n } from '../../../contexts/I18nContext';

export function LiveWeightDisplay({
  weight,
  weightFormatted,
  isStable,
  isOnline,
  deviceName,
  dataAgeSeconds,
  error,
  isLoading,
  onRefresh,
}) {
  const { t } = useI18n();

  const formattedValue = Number(weight || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="card-panel scale-live-display">
      <div className="scale-live-display__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <span className="scale-live-display__eyebrow" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ⚖️ {t('scale.liveWeight')}
          </span>
          <h3 style={{ margin: '2px 0 0 0', fontSize: '16px', color: 'var(--color-text)' }}>
            {deviceName || t('scale.device')}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onRefresh && (
            <button
              type="button"
              className="icon-button"
              onClick={onRefresh}
              style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
              title="Refresh"
            >
              🔄
            </button>
          )}
          {/* Online/Offline Badge */}
          <span
            className={`status-badge ${isOnline ? 'status-badge--success' : 'status-badge--danger'}`}
            style={{
              padding: '4px 10px',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: isOnline ? 'var(--color-success-soft)' : 'var(--color-danger-soft)',
              color: isOnline ? 'var(--color-success)' : 'var(--color-danger)',
              border: `1px solid ${isOnline ? 'var(--color-success)' : 'var(--color-danger)'}`,
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isOnline ? 'var(--color-success)' : 'var(--color-danger)', display: 'inline-block' }} />
            {isOnline ? t('scale.online') : t('scale.offline')}
          </span>

          {/* Stable/Unstable Badge */}
          {isOnline && (
            <span
              className={`status-badge ${isStable ? 'status-badge--primary' : 'status-badge--warning'}`}
              style={{
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: isStable ? 'var(--color-primary-soft)' : 'var(--color-warning-soft)',
                color: isStable ? 'var(--color-primary)' : 'var(--color-warning)',
                border: `1px solid ${isStable ? 'var(--color-primary)' : 'var(--color-warning)'}`,
              }}
            >
              {isStable ? '✓ ' + t('scale.stable') : '⚠️ ' + t('scale.unstable')}
            </span>
          )}
        </div>
      </div>

      {/* Main Digital Readout */}
      <div
        className="scale-live-display__readout"
        style={{
          background: 'var(--color-surface-muted)',
          border: `2px solid ${!isOnline ? 'var(--color-danger)' : !isStable ? 'var(--color-warning)' : 'var(--color-primary)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '24px 16px',
          textAlign: 'center',
          transition: 'all 0.2s ease-in-out',
        }}
      >
        <div
          style={{
            fontSize: '44px',
            fontWeight: 800,
            fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '1px',
            color: !isOnline ? 'var(--color-danger)' : !isStable ? 'var(--color-warning)' : 'var(--color-primary)',
            lineHeight: 1,
          }}
        >
          {isLoading ? '---' : weightFormatted || formattedValue}
          <span style={{ fontSize: '20px', fontWeight: 600, marginLeft: '8px', opacity: 0.85 }}>KG</span>
        </div>

        {/* Readout Subtext / Warning */}
        <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {!isOnline ? (
            <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
              ⚠️ {error || t('scale.mustBeStableWarning')}
            </span>
          ) : !isStable ? (
            <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>
              ⏳ {t('scale.mustBeStableWarning')}
            </span>
          ) : (
            <span>
              {dataAgeSeconds !== null ? `✓ ${t('scale.stable')} (${dataAgeSeconds}s)` : `✓ ${t('scale.stable')}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveWeightDisplay;
