"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
function day(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function Filters() {
  const params = useSearchParams(),
    router = useRouter();
  const [from, setFrom] = useState(params.get("from") ?? ""),
    [to, setTo] = useState(params.get("to") ?? "");
  function preset(value: string) {
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Caracas" }),
    );
    const base = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    let a = new Date(base),
      b = new Date(base);
    if (value === "all") {
      setFrom("");
      setTo("");
      return;
    }
    if (value === "yesterday") {
      a.setUTCDate(a.getUTCDate() - 1);
      b = new Date(a);
    }
    if (value === "week") a.setUTCDate(a.getUTCDate() - 6);
    if (value === "month") a.setUTCDate(1);
    if (value === "lastmonth") {
      a = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
      b = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 0));
    }
    setFrom(day(a));
    setTo(day(b));
  }
  return (
    <form
      className="filters"
      onSubmit={(e) => {
        e.preventDefault();
        const p = new URLSearchParams(params);
        p.delete("page");
        if (from) p.set("from", from);
        else p.delete("from");
        if (to) p.set("to", to);
        else p.delete("to");
        router.push(`?${p}`);
      }}
    >
      <label>
        Período
        <select defaultValue="custom" onChange={(e) => preset(e.target.value)}>
          <option value="custom">Rango personalizado</option>
          <option value="all">Todo el histórico</option>
          <option value="today">Hoy</option>
          <option value="yesterday">Ayer</option>
          <option value="week">Últimos 7 días</option>
          <option value="month">Mes actual</option>
          <option value="lastmonth">Mes anterior</option>
        </select>
      </label>
      <label>
        Desde
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        Hasta
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <button className="button secondary" type="submit">
        Aplicar filtros
      </button>
      <span
        className="muted"
        style={{ fontSize: 11, marginLeft: "auto", paddingBottom: 6 }}
      >
        Por fecha de recepción · Caracas
      </span>
    </form>
  );
}
