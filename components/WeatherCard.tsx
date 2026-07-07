'use client';

import type { WeatherBlock, WeatherDay, WeatherHour } from '@/lib/types';

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  timeZone: 'Europe/Amsterdam',
});

const HOUR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  timeZone: 'Europe/Amsterdam',
});

const WEATHER_ICONS: Record<string, string> = {
  clear: '☀',
  mostly_clear: '🌤',
  partly_cloudy: '⛅',
  cloudy: '☁',
  fog: '🌫',
  drizzle: '🌦',
  rain: '🌧',
  showers: '🌦',
  snow: '🌨',
  thunderstorm: '⛈',
  unknown: '○',
};

function formatTemp(value: number | null) {
  return value == null ? '—' : `${Math.round(value)}°`;
}

function formatWind(value: number | null) {
  return value == null ? null : `${Math.round(value)} km/h`;
}

function formatWeekday(date: string) {
  const value = new Date(`${date}T12:00:00`);
  if (Number.isNaN(value.getTime())) {
    return date;
  }
  return DAY_FORMATTER.format(value);
}

function formatHourLabel(time: string) {
  const value = new Date(time);
  if (Number.isNaN(value.getTime())) {
    return time.slice(11, 16) || time;
  }
  return HOUR_FORMATTER.format(value);
}

function WeatherIcon({ icon, className }: { icon: string; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {WEATHER_ICONS[icon] || WEATHER_ICONS.unknown}
    </span>
  );
}

function DailyCell({ day }: { day: WeatherDay }) {
  return (
    <li className="weather-card__day">
      <div className="weather-card__weekday">{formatWeekday(day.date)}</div>
      <WeatherIcon icon={day.icon} className="weather-card__day-icon" />
      <div className="weather-card__day-temps">
        <strong>{formatTemp(day.high)}</strong>
        <span>{formatTemp(day.low)}</span>
      </div>
    </li>
  );
}

function HourlyChart({ hours }: { hours: WeatherHour[] }) {
  const valid = hours.filter((hour) => hour.temp != null);

  if (valid.length === 0) {
    return null;
  }

  const width = 320;
  const height = 120;
  const padding = 18;
  const values = valid.map((hour) => hour.temp as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  const points = valid.map((hour, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(valid.length - 1, 1);
    const y = height - padding - (((hour.temp as number) - min) / span) * (height - padding * 2);
    return { x, y, hour };
  });

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

  return (
    <div className="weather-card__chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="weather-card__chart-svg" role="img" aria-label="Hourly temperature forecast">
        <defs>
          <linearGradient id="weather-line-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(14, 165, 233, 0.22)" />
            <stop offset="100%" stopColor="rgba(14, 165, 233, 0.02)" />
          </linearGradient>
        </defs>
        <path
          d={`${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`}
          fill="url(#weather-line-fill)"
        />
        <path d={path} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g key={point.hour.time}>
            <circle cx={point.x} cy={point.y} r="4" fill="#f8fafc" stroke="#0f766e" strokeWidth="2" />
            <text x={point.x} y={point.y - 10} textAnchor="middle" className="weather-card__chart-temp">
              {formatTemp(point.hour.temp)}
            </text>
          </g>
        ))}
      </svg>

      <ol className="weather-card__hour-strip">
        {hours.map((hour) => (
          <li key={hour.time}>
            <span>{formatHourLabel(hour.time)}</span>
            <WeatherIcon icon={hour.icon} className="weather-card__hour-icon" />
            <strong>{formatTemp(hour.temp)}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function WeatherCard({ block }: { block: WeatherBlock }) {
  const daily = block.daily || [];
  const hourly = block.hourly || [];
  const wind = formatWind(block.current?.wind ?? null);

  if (!block.current && daily.length === 0 && hourly.length === 0) {
    return null;
  }

  return (
    <section className="weather-card" aria-label={`Weather forecast for ${block.location}`}>
      <div className="weather-card__header">
        <div>
          <div className="weather-card__eyebrow">Forecast</div>
          <h3 className="weather-card__location">{block.location}</h3>
          <div className="weather-card__summary">
            {block.current?.description || 'Weather update'}
            {wind ? <span>Wind {wind}</span> : null}
          </div>
        </div>

        <div className="weather-card__current">
          <WeatherIcon icon={block.current?.icon || 'unknown'} className="weather-card__current-icon" />
          <div className="weather-card__current-temp">
            {block.current?.temp == null ? '—' : `${Math.round(block.current.temp)}°C`}
          </div>
        </div>
      </div>

      {daily.length > 0 ? (
        <ol className="weather-card__days">
          {daily.map((day) => (
            <DailyCell key={day.date} day={day} />
          ))}
        </ol>
      ) : null}

      {hourly.length > 0 ? <HourlyChart hours={hourly} /> : null}
    </section>
  );
}
