import { useEffect, useMemo, useRef, useState } from "react";

import { api, type ModelInfo } from "../api";
import {
  ProviderIcon,
  providerName,
  providerOf,
  shortModelName,
} from "./ProviderMarks";

const emptyModel = (id: string): ModelInfo => ({
  id,
  provider: providerOf(id),
  model: id,
  name: id,
  context: null,
  output: null,
  reasoning: false,
  vision: false,
  tools: false,
});

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || models.length > 0) return;
    let cancelled = false;
    setLoading(true);
    api
      .modelCatalog()
      .then((catalog) => !cancelled && setModels(catalog.models))
      .catch(() => !cancelled && setModels([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, models.length]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const selected = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = models.filter((model) =>
      !needle
        ? true
        : `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(needle),
    );
    if (value && !filtered.some((model) => model.id === value)) {
      filtered.unshift(emptyModel(value));
    }
    return filtered.slice(0, 80);
  }, [models, query, value]);

  const choose = (model: ModelInfo) => {
    onChange(model.id);
    setQuery("");
    setOpen(false);
  };

  const closedLabel = selected
    ? shortModelName(selected.name, selected.provider)
    : shortModelName(value, providerOf(value));

  return (
    <div className="model-picker" ref={root}>
      {open ? (
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={loading ? "Loading models…" : "Search models"}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((current) => Math.min(current + 1, visible.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && visible[cursor]) {
              event.preventDefault();
              choose(visible[cursor]);
            }
          }}
        />
      ) : (
        <div className="model-picker-closed">
          <button
            className="model-picker-value"
            onClick={() => setOpen(true)}
            data-tooltip={value || "No model selected"}
          >
            {value ? (
              <>
                <ProviderIcon provider={selected?.provider ?? providerOf(value)} />
                <span className="model-picker-label">{closedLabel}</span>
              </>
            ) : (
              <span className="model-picker-placeholder">Select model</span>
            )}
            <svg className="model-chevron" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>
          {value && (
            <button
              className="model-picker-clear"
              data-tooltip="Clear model"
              onClick={() => choose(emptyModel(""))}
            >
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {open && (
        <ul className="model-options">
          {visible.length === 0 ? (
            <li className="model-empty">No matching models</li>
          ) : (
            visible.map((model, index) => (
              <li key={model.id}>
                <button
                  className={index === cursor ? "model-option active" : "model-option"}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(model)}
                >
                  <ProviderIcon provider={model.provider} />
                  <span className="model-option-name">
                    <strong>{shortModelName(model.name, model.provider)}</strong>
                    <small>{providerName(model.provider)}</small>
                  </span>
                  <small className="model-capabilities">
                    {model.reasoning ? "reasoning · " : ""}
                    {model.vision ? "vision · " : ""}
                    {model.context ? `${Math.round(model.context / 1000)}k` : ""}
                  </small>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
