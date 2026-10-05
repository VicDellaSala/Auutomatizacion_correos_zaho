import type { Match, MatchMail } from "@/types/email";
const generic =
  /^(solicitud|consulta|informaci[oó]n|requerimiento|soporte|sin asunto|\(sin asunto\))$/i;
export function matchEmails(mails: MatchMail[]): Map<string, Match> {
  const byKey = new Map(mails.map((m) => [m.key, m]));
  const byId = new Map(
    mails.filter((m) => m.messageId).map((m) => [m.messageId!, m]),
  );
  const bySubject = new Map<string, MatchMail[]>();
  for (const m of mails) {
    const group = bySubject.get(m.normalizedSubject) ?? [];
    group.push(m);
    bySubject.set(m.normalizedSubject, group);
  }
  const results = new Map<string, Match>();
  const visiting = new Set<string>();
  function resolve(mail: MatchMail): Match {
    if (results.has(mail.key)) return results.get(mail.key)!;
    if (visiting.has(mail.key))
      return {
        kind: "REVIEW",
        rootKey: null,
        reason: "Referencias cíclicas",
        candidates: [],
      };
    visiting.add(mail.key);
    const review = (reason: string, candidates: string[] = []): Match => ({
      kind: "REVIEW",
      rootKey: null,
      reason,
      candidates,
    });
    let match: Match;
    const link = (target: MatchMail): Match => {
      const parent = resolve(target);
      const root = parent.rootKey ? byKey.get(parent.rootKey) : undefined;
      if (
        !root ||
        root.key === mail.key ||
        Date.parse(mail.date) <= Date.parse(root.date) ||
        Date.parse(mail.date) < Date.parse(target.date)
      )
        return review("La relación no tiene una solicitud anterior válida", [
          target.key,
        ]);
      const rootMatch = results.get(root.key);
      if (
        mail.staffName &&
        root.decision?.excludedResponseKeys?.includes(mail.key)
      )
        return review(
          "Esta asociación se excluyó al marcar la solicitud como no respondida",
          [root.key],
        );
      const kind =
        mail.staffName && rootMatch?.kind === "REQUEST"
          ? "RESPONSE"
          : "FOLLOWUP";
      return {
        kind,
        rootKey: root.key,
        reason: "Cabeceras de conversación verificadas",
        candidates: [],
        dependencies: [
          ...new Set([target.key, root.key, ...(parent.dependencies ?? [])]),
        ],
      };
    };
    if (
      mail.approvedKind &&
      (mail.approvedKind !== "REVIEW" || mail.approvedRootKey)
    ) {
      if (
        mail.approvedKind === "REQUEST" ||
        mail.approvedKind === "STAFF_SENT"
      ) {
        match = {
          kind: mail.approvedKind,
          rootKey: mail.key,
          reason: "Clasificación histórica aprobada",
          candidates: [],
        };
      } else {
        const root = mail.approvedRootKey
          ? byKey.get(mail.approvedRootKey)
          : undefined;
        match = root
          ? link(root)
          : review("La solicitud histórica asociada ya no está disponible");
        if (match.kind !== "REVIEW")
          match.reason = "Asociación histórica aprobada";
      }
    } else if (mail.decision) {
      const d = mail.decision;
      if (d.kind === "REQUEST" || d.kind === "STAFF_SENT") {
        match =
          (d.kind === "STAFF_SENT") !== Boolean(mail.staffName)
            ? review("Clasificación incompatible con el remitente")
            : {
                kind: d.kind,
                rootKey: mail.key,
                reason: "Clasificación manual",
                candidates: [],
              };
      } else {
        const target = d.targetKey && byKey.get(d.targetKey);
        match =
          target &&
          target.key !== mail.key &&
          (resolve(target).kind === "REQUEST" ||
            (d.kind === "FOLLOWUP" && resolve(target).kind === "STAFF_SENT"))
            ? link(target)
            : review(
                "El correo asociado no está incorporado",
                d.targetKey ? [d.targetKey] : [],
              );
        if (match.kind !== d.kind)
          match = review(
            "La relación manual no cumple las reglas de respuesta válida",
          );
        else match.reason = "Asociación manual verificada";
      }
    } else if (!mail.addressed) {
      match = review("El buzón configurado no figura en Para ni CC");
    } else {
      const direct = mail.inReplyTo
        .map((id) => byId.get(id))
        .filter((m): m is MatchMail => !!m);
      const refs = [...mail.references]
        .reverse()
        .map((id) => byId.get(id))
        .filter((m): m is MatchMail => !!m);
      if (direct.length > 1)
        match = review(
          "Varias referencias directas posibles",
          direct.map((m) => m.key),
        );
      else if (direct[0] || refs[0]) match = link(direct[0] ?? refs[0]);
      else {
        const isReply =
          mail.inReplyTo.length > 0 ||
          mail.references.length > 0 ||
          /^(\s*(?:re|rv|fw|fwd|respuesta|reenviar)(?:\[\d+\])?\s*:)/i.test(
            mail.subject,
          );
        if (!isReply && !mail.staffName)
          match = {
            kind: mail.staffName ? "STAFF_SENT" : "REQUEST",
            rootKey: mail.key,
            reason: "Correo inicial dirigido al buzón",
            candidates: [],
          };
        else {
          const participants = new Set(
            [...mail.to, ...mail.cc].map((a) => a.address),
          );
          const possible = (bySubject.get(mail.normalizedSubject) ?? []).filter(
            (m) =>
              m.key !== mail.key &&
              !m.staffName &&
              Date.parse(m.date) < Date.parse(mail.date) &&
              Date.parse(mail.date) - Date.parse(m.date) < 7 * 86400000 &&
              (participants.has(m.from.address) ||
                m.from.address === mail.from.address),
          );
          const roots = [
            ...new Set(
              possible
                .map((m) => resolve(m).rootKey)
                .filter((key): key is string => !!key),
            ),
          ]
            .map((key) => byKey.get(key)!)
            .filter(
              (m) =>
                resolve(m).kind === "REQUEST" &&
                (!generic.test(mail.normalizedSubject) ||
                  Date.parse(mail.date) - Date.parse(m.date) <= 86400000),
            );
          if (
            roots.length === 1 &&
            mail.normalizedSubject &&
            !/^(sin asunto|\(sin asunto\))$/i.test(mail.normalizedSubject)
          ) {
            match = link(roots[0]);
            if (match.kind !== "REVIEW")
              match.reason =
                "Asociada automáticamente: asunto, participantes, buzón y cronología compatibles; una sola solicitud candidata";
          } else if (!isReply && !possible.length) {
            match = {
              kind: "STAFF_SENT",
              rootKey: mail.key,
              reason: "Correo inicial del personal dirigido al buzón",
              candidates: [],
            };
          } else {
            match = review(
              roots.length > 1
                ? "Varias solicitudes compatibles: selecciona el original"
                : "No hay una solicitud anterior con suficiente contexto",
              possible.slice(0, 20).map((m) => m.key),
            );
          }
        }
      }
    }
    visiting.delete(mail.key);
    results.set(mail.key, match);
    return match;
  }
  for (const mail of [...mails].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  ))
    resolve(mail);
  return results;
}
