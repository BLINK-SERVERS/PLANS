-- ============================================================
--  BLINK Plans · esquema de negocio en Neon
-- ============================================================
--  Cómo se obtuvo (no es un archivo escrito a mano):
--    1. se creó una rama limpia de Neon (esquema-base, proyecto plans-prod);
--    2. se aplicó db/0000_auth_uid.sql y después las 12 migraciones del
--       proyecto viejo portadas a un solo flujo, retirando tres bloques que
--       solo existen en Supabase (ver db/README.md);
--    3. se volcó el estado final con pg_dump 18.6 --schema-only --no-owner
--       --no-privileges --no-tablespaces;
--    4. se le quitaron los meta-comandos \restrict/\unrestrict de pg_dump.
--
--  Por qué así y no reaplicando 0001..0012 en producción: 0003, 0004, 0005 y
--  0011 contienen INSERT con UUIDs fijos, DROP CONSTRAINT y un
--  `delete from planes where duracion_dias >= 540` que sobre datos reales
--  borraría filas. El estado final ya integra todo eso; reaplicarlo es la
--  deuda que el plan prohibe.
--
--  Los datos NO van aquí: el catálogo real y los clientes migrados llegan del
--  volcado del proyecto viejo (Fase 4, parte datos). Esta es la estructura.
-- ============================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (ac70818)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: editar_pago(uuid, uuid, numeric, text, numeric, numeric, numeric, text, date, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_pago(p_pago_id uuid, p_cliente_id uuid, p_monto_pagado numeric, p_moneda text, p_tasa_bcv_aplicada numeric, p_tasa_cambio_binance numeric, p_equivalente_usd numeric, p_metodo_pago text, p_fecha_pago date, p_asignados jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_item jsonb;
begin
    if not public.es_admin() then
        raise exception 'Solo el admin puede editar pagos';
    end if;

    -- 1) Actualizar el ingreso (las validaciones de moneda/método aplican).
    update public.pagos_ingresos
       set cliente_id          = p_cliente_id,
           monto_pagado        = p_monto_pagado,
           moneda              = p_moneda,
           tasa_bcv_aplicada   = p_tasa_bcv_aplicada,
           tasa_cambio_binance = p_tasa_cambio_binance,
           equivalente_usd     = p_equivalente_usd,
           metodo_pago         = p_metodo_pago,
           fecha_pago          = p_fecha_pago
     where id = p_pago_id;

    -- 2) Recomponer la asignación y la comisión (el trigger de comisión
    --    solo dispara en INSERT, así que se borra todo y se reinserta).
    delete from public.pago_suscripciones where pago_ingreso_id = p_pago_id;
    delete from public.comisiones          where pago_id          = p_pago_id;

    for v_item in select * from jsonb_array_elements(p_asignados)
    loop
        insert into public.pago_suscripciones
            (pago_ingreso_id, suscripcion_id, monto_asignado_usd)
        values (
            p_pago_id,
            (v_item->>'suscripcion_id')::uuid,
            (v_item->>'monto_usd')::numeric
        );
    end loop;
end $$;


--
-- Name: es_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.es_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    select exists (
        select 1
          from public.usuarios u
         where u.id = auth.uid()
           and u.rol = 'admin'
    );
$$;


--
-- Name: gestionar_cupos_cuenta_madre(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gestionar_cupos_cuenta_madre() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_cupos  integer;
    v_total  integer;
begin
    if tg_op = 'INSERT' then
        if new.estado = 'activa' then
            select cupos_ocupados, cupos_totales into v_cupos, v_total
              from public.cuentas_madre
             where id = new.cuenta_madre_id;
            if not found then
                raise exception 'Cuenta madre % no existe', new.cuenta_madre_id;
            end if;
            if v_cupos >= v_total then
                raise exception 'Cuenta madre sin cupos disponibles (limite %)', v_total;
            end if;
            update public.cuentas_madre
               set cupos_ocupados = cupos_ocupados + 1
             where id = new.cuenta_madre_id;
        end if;

    elsif tg_op = 'UPDATE' then
        if old.estado = 'activa' and new.estado <> 'activa' then
            update public.cuentas_madre
               set cupos_ocupados = greatest(cupos_ocupados - 1, 0)
             where id = old.cuenta_madre_id;
        elsif old.estado <> 'activa' and new.estado = 'activa' then
            select cupos_ocupados, cupos_totales into v_cupos, v_total
              from public.cuentas_madre
             where id = new.cuenta_madre_id;
            if v_cupos >= v_total then
                raise exception 'Cuenta madre sin cupos disponibles (limite %)', v_total;
            end if;
            update public.cuentas_madre
               set cupos_ocupados = cupos_ocupados + 1
             where id = new.cuenta_madre_id;
        end if;

    elsif tg_op = 'DELETE' then
        if old.estado = 'activa' then
            update public.cuentas_madre
               set cupos_ocupados = greatest(cupos_ocupados - 1, 0)
             where id = old.cuenta_madre_id;
        end if;
    end if;

    return coalesce(new, old);
end $$;


--
-- Name: registrar_comision_por_referido(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_comision_por_referido() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cliente  uuid;
    v_referido uuid;
    v_aplica   boolean;
BEGIN
    SELECT s.cliente_id, COALESCE(pl.aplica_comision, false)
      INTO v_cliente, v_aplica
      FROM public.suscripciones s
      JOIN public.planes p        ON p.id = s.plan_id
      JOIN public.plataformas pl  ON pl.id = p.plataforma_id
     WHERE s.id = new.suscripcion_id;

    IF v_cliente IS NULL OR NOT v_aplica THEN
        RETURN new;
    END IF;

    SELECT referido_por INTO v_referido
      FROM public.usuarios
     WHERE id = v_cliente;

    IF v_referido IS NOT NULL THEN
        INSERT INTO public.comisiones (agente_id, pago_id, monto_comision_usd, estado)
        VALUES (v_referido, new.pago_ingreso_id,
                round(new.monto_asignado_usd * 0.30, 2), 'pendiente');
    END IF;

    RETURN new;
END $$;


--
-- Name: renovar_suscripcion_por_pago(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renovar_suscripcion_por_pago() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_dias   integer;
    v_ppago  date;
begin
    select p.duracion_dias into v_dias
      from public.suscripciones s
      join public.planes p on p.id = s.plan_id
     where s.id = new.suscripcion_id;

    if v_dias is null then
        return new;
    end if;

    -- Fecha de referencia: la fecha del pago (soporta cobros atrasados).
    select pis.fecha_pago into v_ppago
      from public.pagos_ingresos pis
     where pis.id = new.pago_ingreso_id;

    if v_ppago is null then
        v_ppago := current_date;
    end if;

    update public.suscripciones
       set fecha_corte_cliente = greatest(
               coalesce(fecha_corte_cliente, v_ppago), v_ppago
           ) + v_dias,
           estado = 'activa'
     where id = new.suscripcion_id;

    return new;
end $$;


--
-- Name: validar_plataforma_suscripcion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validar_plataforma_suscripcion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_plan_plataforma    text;
    v_cuenta_plataforma  text;
begin
    select pl.nombre into v_plan_plataforma
      from public.planes p
      join public.plataformas pl on pl.id = p.plataforma_id
     where p.id = new.plan_id;

    select pl.nombre into v_cuenta_plataforma
      from public.cuentas_madre cm
      join public.plataformas pl on pl.id = cm.plataforma_id
     where cm.id = new.cuenta_madre_id;

    if v_plan_plataforma is null then
        raise exception 'El plan % no existe', new.plan_id;
    end if;
    if v_cuenta_plataforma is null then
        raise exception 'La cuenta madre % no existe', new.cuenta_madre_id;
    end if;
    if v_plan_plataforma <> v_cuenta_plataforma then
        raise exception 'El plan es de % pero la cuenta madre es de %: asignación inválida',
            v_plan_plataforma, v_cuenta_plataforma;
    end if;

    return new;
end $$;


SET default_table_access_method = heap;

--
-- Name: comisiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comisiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agente_id uuid NOT NULL,
    pago_id uuid NOT NULL,
    monto_comision_usd numeric(12,2) NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comisiones_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'liquidada'::text]))),
    CONSTRAINT comisiones_monto_comision_usd_check CHECK ((monto_comision_usd >= (0)::numeric))
);


--
-- Name: cuentas_madre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentas_madre (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proveedor_id uuid,
    plataforma_id uuid NOT NULL,
    correo_cuenta text NOT NULL,
    cupos_totales integer NOT NULL,
    cupos_ocupados integer DEFAULT 0 NOT NULL,
    costo_renovacion_usd numeric(12,2) NOT NULL,
    fecha_corte_proveedor date,
    estado text DEFAULT 'activa'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cuentas_madre_check CHECK (((cupos_ocupados >= 0) AND (cupos_ocupados <= cupos_totales))),
    CONSTRAINT cuentas_madre_costo_renovacion_usd_check CHECK ((costo_renovacion_usd >= (0)::numeric)),
    CONSTRAINT cuentas_madre_cupos_totales_check CHECK ((cupos_totales > 0)),
    CONSTRAINT cuentas_madre_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'suspendida'::text, 'baja'::text])))
);


--
-- Name: pago_suscripciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pago_suscripciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pago_ingreso_id uuid NOT NULL,
    suscripcion_id uuid NOT NULL,
    monto_asignado_usd numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pago_suscripciones_monto_asignado_usd_check CHECK ((monto_asignado_usd >= (0)::numeric))
);


--
-- Name: pagos_egresos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos_egresos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proveedor_id uuid NOT NULL,
    cuenta_madre_id uuid NOT NULL,
    monto_pagado_usd numeric(12,2) NOT NULL,
    fecha_pago date DEFAULT CURRENT_DATE NOT NULL,
    comprobante_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pagos_egresos_monto_pagado_usd_check CHECK ((monto_pagado_usd >= (0)::numeric))
);


--
-- Name: pagos_ingresos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos_ingresos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    monto_pagado numeric(12,2) NOT NULL,
    moneda text NOT NULL,
    tasa_bcv_aplicada numeric(12,4),
    equivalente_usd numeric(12,2) NOT NULL,
    metodo_pago text,
    fecha_pago date DEFAULT CURRENT_DATE NOT NULL,
    comprobante_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tasa_cambio_binance numeric(12,4),
    CONSTRAINT pagos_ingresos_equivalente_usd_check CHECK ((equivalente_usd >= (0)::numeric)),
    CONSTRAINT pagos_ingresos_metodo_pago_check CHECK ((metodo_pago = ANY (ARRAY['Zelle'::text, 'Pago Movil'::text, 'Pago Movil Binance'::text, 'Binance'::text, 'Transferencia'::text, 'Otro'::text]))),
    CONSTRAINT pagos_ingresos_moneda_check CHECK ((moneda = ANY (ARRAY['USD'::text, 'BS'::text, 'USDT'::text]))),
    CONSTRAINT pagos_ingresos_monto_pagado_check CHECK ((monto_pagado >= (0)::numeric))
);


--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo text NOT NULL,
    plataforma text NOT NULL,
    duracion_dias integer,
    precio_usd numeric(12,2),
    valor_giftcard_usd numeric(12,2),
    precio_giftcard_eur numeric(12,2),
    diseno_giftcard text,
    cliente_id uuid,
    cliente_nombre text,
    cliente_contacto text,
    estado text DEFAULT 'nuevo'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metodo_pago text,
    moneda_cobro text,
    monto_cobro numeric(12,2),
    CONSTRAINT pedidos_estado_check CHECK ((estado = ANY (ARRAY['nuevo'::text, 'contactado'::text, 'completado'::text, 'cancelado'::text]))),
    CONSTRAINT pedidos_tipo_check CHECK ((tipo = ANY (ARRAY['plan'::text, 'giftcard'::text])))
);


--
-- Name: COLUMN pedidos.metodo_pago; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.metodo_pago IS 'Método con que el cliente pagará: pagomovil | usdt | usdc | zinli | binance';


--
-- Name: COLUMN pedidos.moneda_cobro; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.moneda_cobro IS 'Moneda cotizada del cobro: BS, USDT, USDC o USD (Zinli)';


--
-- Name: COLUMN pedidos.monto_cobro; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.monto_cobro IS 'Monto exacto cotizado en el checkout (la tasa puede cambiar después)';


--
-- Name: planes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plataforma_id uuid NOT NULL,
    duracion_dias integer NOT NULL,
    precio_venta_usd numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_referencia_usd numeric(12,2),
    CONSTRAINT planes_duracion_dias_check CHECK ((duracion_dias > 0)),
    CONSTRAINT planes_precio_venta_usd_check CHECK ((precio_venta_usd >= (0)::numeric))
);


--
-- Name: plataformas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plataformas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    logo_url text,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aplica_comision boolean DEFAULT true NOT NULL
);


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    contacto text,
    metodo_pago_preferido text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: suscripciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suscripciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    cuenta_madre_id uuid NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_corte_cliente date NOT NULL,
    estado text DEFAULT 'activa'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT suscripciones_check CHECK ((fecha_corte_cliente >= fecha_inicio)),
    CONSTRAINT suscripciones_estado_check CHECK ((estado = ANY (ARRAY['activa'::text, 'vencida'::text, 'cancelada'::text])))
);


--
-- Name: tasas_cambio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasas_cambio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fecha date NOT NULL,
    tasa_bcv numeric(12,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tasa_eur_bs numeric(12,4),
    CONSTRAINT tasas_cambio_tasa_bcv_check CHECK ((tasa_bcv > (0)::numeric))
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rol text DEFAULT 'cliente'::text NOT NULL,
    nombre text NOT NULL,
    email text,
    telefono text,
    referido_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK ((rol = ANY (ARRAY['admin'::text, 'agente'::text, 'cliente'::text])))
);


--
-- Name: v_catalogo_publico; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_catalogo_publico WITH (security_invoker='true') AS
 SELECT pl.nombre AS plataforma,
    pl.logo_url,
    p.duracion_dias,
    p.precio_venta_usd,
    p.precio_referencia_usd
   FROM (public.planes p
     JOIN public.plataformas pl ON ((pl.id = p.plataforma_id)))
  WHERE pl.activa;


--
-- Name: v_vencimientos_proveedores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_vencimientos_proveedores WITH (security_invoker='true') AS
 SELECT cm.id,
    COALESCE(p.nombre, 'Directo'::text) AS proveedor,
    pl.nombre AS plataforma,
    cm.correo_cuenta,
    cm.cupos_ocupados,
    cm.cupos_totales,
    cm.costo_renovacion_usd,
    cm.fecha_corte_proveedor,
    (cm.fecha_corte_proveedor - CURRENT_DATE) AS dias_restantes
   FROM ((public.cuentas_madre cm
     LEFT JOIN public.proveedores p ON ((p.id = cm.proveedor_id)))
     JOIN public.plataformas pl ON ((pl.id = cm.plataforma_id)))
  WHERE ((cm.estado = 'activa'::text) AND (cm.fecha_corte_proveedor IS NOT NULL) AND (cm.fecha_corte_proveedor <= (CURRENT_DATE + 3)));


--
-- Name: comisiones comisiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comisiones
    ADD CONSTRAINT comisiones_pkey PRIMARY KEY (id);


--
-- Name: cuentas_madre cuentas_madre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_madre
    ADD CONSTRAINT cuentas_madre_pkey PRIMARY KEY (id);


--
-- Name: pago_suscripciones pago_suscripciones_pago_ingreso_id_suscripcion_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_suscripciones
    ADD CONSTRAINT pago_suscripciones_pago_ingreso_id_suscripcion_id_key UNIQUE (pago_ingreso_id, suscripcion_id);


--
-- Name: pago_suscripciones pago_suscripciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_suscripciones
    ADD CONSTRAINT pago_suscripciones_pkey PRIMARY KEY (id);


--
-- Name: pagos_egresos pagos_egresos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_egresos
    ADD CONSTRAINT pagos_egresos_pkey PRIMARY KEY (id);


--
-- Name: pagos_ingresos pagos_ingresos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_ingresos
    ADD CONSTRAINT pagos_ingresos_pkey PRIMARY KEY (id);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);


--
-- Name: planes planes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_pkey PRIMARY KEY (id);


--
-- Name: planes planes_plataforma_id_duracion_dias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_plataforma_id_duracion_dias_key UNIQUE (plataforma_id, duracion_dias);


--
-- Name: plataformas plataformas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plataformas
    ADD CONSTRAINT plataformas_nombre_key UNIQUE (nombre);


--
-- Name: plataformas plataformas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plataformas
    ADD CONSTRAINT plataformas_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: suscripciones suscripciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_pkey PRIMARY KEY (id);


--
-- Name: tasas_cambio tasas_cambio_fecha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasas_cambio
    ADD CONSTRAINT tasas_cambio_fecha_key UNIQUE (fecha);


--
-- Name: tasas_cambio tasas_cambio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasas_cambio
    ADD CONSTRAINT tasas_cambio_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_comisiones_agente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comisiones_agente ON public.comisiones USING btree (agente_id);


--
-- Name: idx_cuentas_plataforma; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuentas_plataforma ON public.cuentas_madre USING btree (plataforma_id);


--
-- Name: idx_cuentas_proveedor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuentas_proveedor ON public.cuentas_madre USING btree (proveedor_id);


--
-- Name: idx_pagos_egr_prov; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_egr_prov ON public.pagos_egresos USING btree (proveedor_id);


--
-- Name: idx_pagos_ing_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_ing_cliente ON public.pagos_ingresos USING btree (cliente_id);


--
-- Name: idx_pedidos_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_cliente ON public.pedidos USING btree (cliente_id);


--
-- Name: idx_pedidos_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_created ON public.pedidos USING btree (created_at DESC);


--
-- Name: idx_pedidos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_estado ON public.pedidos USING btree (estado);


--
-- Name: idx_planes_plataforma; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planes_plataforma ON public.planes USING btree (plataforma_id);


--
-- Name: idx_ps_pago; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ps_pago ON public.pago_suscripciones USING btree (pago_ingreso_id);


--
-- Name: idx_ps_susc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ps_susc ON public.pago_suscripciones USING btree (suscripcion_id);


--
-- Name: idx_susc_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_cliente ON public.suscripciones USING btree (cliente_id);


--
-- Name: idx_susc_corte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_corte ON public.suscripciones USING btree (fecha_corte_cliente);


--
-- Name: idx_susc_cuenta_madre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_susc_cuenta_madre ON public.suscripciones USING btree (cuenta_madre_id);


--
-- Name: pago_suscripciones trg_comision_referido; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comision_referido AFTER INSERT ON public.pago_suscripciones FOR EACH ROW EXECUTE FUNCTION public.registrar_comision_por_referido();


--
-- Name: suscripciones trg_cupos_after_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cupos_after_delete AFTER DELETE ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.gestionar_cupos_cuenta_madre();


--
-- Name: suscripciones trg_cupos_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cupos_after_insert AFTER INSERT ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.gestionar_cupos_cuenta_madre();


--
-- Name: suscripciones trg_cupos_after_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cupos_after_update AFTER UPDATE OF estado ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.gestionar_cupos_cuenta_madre();


--
-- Name: pago_suscripciones trg_renovar_susc_por_pago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_renovar_susc_por_pago AFTER INSERT ON public.pago_suscripciones FOR EACH ROW EXECUTE FUNCTION public.renovar_suscripcion_por_pago();


--
-- Name: suscripciones trg_validar_plataforma_susc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_plataforma_susc BEFORE INSERT OR UPDATE OF plan_id, cuenta_madre_id ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.validar_plataforma_suscripcion();


--
-- Name: comisiones comisiones_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comisiones
    ADD CONSTRAINT comisiones_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: comisiones comisiones_pago_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comisiones
    ADD CONSTRAINT comisiones_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES public.pagos_ingresos(id) ON DELETE CASCADE;


--
-- Name: cuentas_madre cuentas_madre_plataforma_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_madre
    ADD CONSTRAINT cuentas_madre_plataforma_id_fkey FOREIGN KEY (plataforma_id) REFERENCES public.plataformas(id) ON DELETE CASCADE;


--
-- Name: cuentas_madre cuentas_madre_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_madre
    ADD CONSTRAINT cuentas_madre_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- Name: pago_suscripciones pago_suscripciones_pago_ingreso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_suscripciones
    ADD CONSTRAINT pago_suscripciones_pago_ingreso_id_fkey FOREIGN KEY (pago_ingreso_id) REFERENCES public.pagos_ingresos(id) ON DELETE CASCADE;


--
-- Name: pago_suscripciones pago_suscripciones_suscripcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_suscripciones
    ADD CONSTRAINT pago_suscripciones_suscripcion_id_fkey FOREIGN KEY (suscripcion_id) REFERENCES public.suscripciones(id) ON DELETE CASCADE;


--
-- Name: pagos_egresos pagos_egresos_cuenta_madre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_egresos
    ADD CONSTRAINT pagos_egresos_cuenta_madre_id_fkey FOREIGN KEY (cuenta_madre_id) REFERENCES public.cuentas_madre(id) ON DELETE CASCADE;


--
-- Name: pagos_egresos pagos_egresos_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_egresos
    ADD CONSTRAINT pagos_egresos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;


--
-- Name: pagos_ingresos pagos_ingresos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos_ingresos
    ADD CONSTRAINT pagos_ingresos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: pedidos pedidos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: planes planes_plataforma_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes
    ADD CONSTRAINT planes_plataforma_id_fkey FOREIGN KEY (plataforma_id) REFERENCES public.plataformas(id) ON DELETE CASCADE;


--
-- Name: suscripciones suscripciones_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: suscripciones suscripciones_cuenta_madre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_cuenta_madre_id_fkey FOREIGN KEY (cuenta_madre_id) REFERENCES public.cuentas_madre(id) ON DELETE CASCADE;


--
-- Name: suscripciones suscripciones_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE RESTRICT;


--
-- Name: usuarios usuarios_referido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_referido_por_fkey FOREIGN KEY (referido_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: comisiones admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.comisiones USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: cuentas_madre admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.cuentas_madre USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: pago_suscripciones admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.pago_suscripciones USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: pagos_egresos admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.pagos_egresos USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: pagos_ingresos admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.pagos_ingresos USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: planes admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.planes USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: plataformas admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.plataformas USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: proveedores admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.proveedores USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: suscripciones admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.suscripciones USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: tasas_cambio admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.tasas_cambio USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: usuarios admin_acceso_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_acceso_total ON public.usuarios USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: pedidos admin_pedidos_total; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_pedidos_total ON public.pedidos USING (public.es_admin()) WITH CHECK (public.es_admin());


--
-- Name: comisiones agente_lee_su_comision; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agente_lee_su_comision ON public.comisiones FOR SELECT USING ((agente_id = auth.uid()));


--
-- Name: plataformas catalogo_publico_lectura; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY catalogo_publico_lectura ON public.plataformas FOR SELECT USING (true);


--
-- Name: planes catalogo_publico_planes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY catalogo_publico_planes ON public.planes FOR SELECT USING (true);


--
-- Name: pedidos cliente_crea_su_pedido; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cliente_crea_su_pedido ON public.pedidos FOR INSERT TO authenticated WITH CHECK ((cliente_id = auth.uid()));


--
-- Name: usuarios cliente_edita_su_fila; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cliente_edita_su_fila ON public.usuarios FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (rol = 'cliente'::text)));


--
-- Name: usuarios cliente_ve_su_fila; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cliente_ve_su_fila ON public.usuarios FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: pedidos cliente_ve_sus_pedidos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cliente_ve_sus_pedidos ON public.pedidos FOR SELECT TO authenticated USING ((cliente_id = auth.uid()));


--
-- Name: comisiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comisiones ENABLE ROW LEVEL SECURITY;

--
-- Name: cuentas_madre; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cuentas_madre ENABLE ROW LEVEL SECURITY;

--
-- Name: pago_suscripciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pago_suscripciones ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos_egresos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos_egresos ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos_ingresos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos_ingresos ENABLE ROW LEVEL SECURITY;

--
-- Name: pedidos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

--
-- Name: planes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.planes ENABLE ROW LEVEL SECURITY;

--
-- Name: plataformas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plataformas ENABLE ROW LEVEL SECURITY;

--
-- Name: proveedores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

--
-- Name: suscripciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;

--
-- Name: tasas_cambio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasas_cambio ENABLE ROW LEVEL SECURITY;

--
-- Name: usuarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


