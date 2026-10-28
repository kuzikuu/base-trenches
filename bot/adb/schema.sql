-- Base Trenches schema (Oracle Autonomous Database, schema BASETRENCHES).
-- Applied through ORDS REST-enabled SQL; each statement is separated by a line with a single "/".
CREATE OR REPLACE FUNCTION bt_ts(p_ms IN NUMBER) RETURN TIMESTAMP WITH TIME ZONE DETERMINISTIC IS
BEGIN
  IF p_ms IS NULL THEN RETURN NULL; END IF;
  RETURN TIMESTAMP '1970-01-01 00:00:00 UTC' + NUMTODSINTERVAL(p_ms / 1000, 'SECOND');
END;
/
CREATE TABLE bt_users (
  telegram_id   NUMBER(20)      CONSTRAINT bt_users_pk PRIMARY KEY,
  username      VARCHAR2(64),
  first_name    VARCHAR2(128),
  x_handle      VARCHAR2(32),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
)
/
CREATE INDEX bt_users_username_ix ON bt_users (LOWER(username))
/
CREATE TABLE bt_coins (
  ca               VARCHAR2(42)   CONSTRAINT bt_coins_pk PRIMARY KEY
                                  CONSTRAINT bt_coins_ca_ck CHECK (REGEXP_LIKE(ca, '^0x[0-9a-f]{40}$')),
  symbol           VARCHAR2(32),
  name             VARCHAR2(128),
  chain            VARCHAR2(16)   DEFAULT 'base' NOT NULL,
  pair_url         VARCHAR2(512),
  image            VARCHAR2(1024),
  status           VARCHAR2(16)   DEFAULT 'tagging' NOT NULL
                                  CONSTRAINT bt_coins_status_ck CHECK (status IN ('tagging','powered','pinned')),
  first_tagger_id  NUMBER(20)     CONSTRAINT bt_coins_tagger_fk REFERENCES bt_users (telegram_id),
  first_tagged_at  TIMESTAMP WITH TIME ZONE,
  cur_price_usd    NUMBER,
  cur_mcap_usd     NUMBER,
  price_updated_at TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
)
/
CREATE TABLE bt_tags (
  ca          VARCHAR2(42) NOT NULL CONSTRAINT bt_tags_coin_fk REFERENCES bt_coins (ca),
  telegram_id NUMBER(20)   NOT NULL CONSTRAINT bt_tags_user_fk REFERENCES bt_users (telegram_id),
  tagged_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  chat_id     NUMBER(20),
  msg_id      NUMBER(20),
  CONSTRAINT bt_tags_pk PRIMARY KEY (ca, telegram_id)          -- one tag per user per coin
)
/
CREATE INDEX bt_tags_user_ix ON bt_tags (telegram_id)
/
CREATE TABLE bt_calls (
  ca                 VARCHAR2(42) CONSTRAINT bt_calls_pk PRIMARY KEY
                                  CONSTRAINT bt_calls_coin_fk REFERENCES bt_coins (ca),
  caller_id          NUMBER(20)   NOT NULL CONSTRAINT bt_calls_caller_fk REFERENCES bt_users (telegram_id),
  status             VARCHAR2(16) NOT NULL CONSTRAINT bt_calls_status_ck CHECK (status IN ('powered','pinned')),
  called_at          TIMESTAMP WITH TIME ZONE NOT NULL,
  call_price_usd     NUMBER,
  call_mcap_usd      NUMBER,
  ath_price_usd      NUMBER,
  ath_mcap_usd       NUMBER,
  ath_at             TIMESTAMP WITH TIME ZONE,
  cur_price_usd      NUMBER,
  cur_mcap_usd       NUMBER,
  x_post_url         VARCHAR2(256),
  replies            NUMBER(10),
  reposts            NUMBER(10),
  likes              NUMBER(10),
  engagement_at      TIMESTAMP WITH TIME ZONE,
  pinned_at          TIMESTAMP WITH TIME ZONE,
  channel_msg_id     NUMBER(20),
  group_msg_id       NUMBER(20),
  pin_channel_msg_id NUMBER(20),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
)
/
CREATE INDEX bt_calls_caller_ix ON bt_calls (caller_id, called_at)
/
CREATE TABLE bt_call_taggers (
  ca          VARCHAR2(42) NOT NULL CONSTRAINT bt_ct_call_fk REFERENCES bt_calls (ca),
  telegram_id NUMBER(20)   NOT NULL CONSTRAINT bt_ct_user_fk REFERENCES bt_users (telegram_id),
  position    NUMBER(2)    NOT NULL CONSTRAINT bt_ct_pos_ck CHECK (position BETWEEN 1 AND 9),
  tagged_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT bt_call_taggers_pk PRIMARY KEY (ca, telegram_id),
  CONSTRAINT bt_call_taggers_pos_uk UNIQUE (ca, position)
)
/
CREATE TABLE bt_engagement_snapshots (
  id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT bt_eng_pk PRIMARY KEY,
  ca          VARCHAR2(42) NOT NULL CONSTRAINT bt_eng_coin_fk REFERENCES bt_coins (ca),
  post_url    VARCHAR2(256),
  replies     NUMBER(10) NOT NULL,
  reposts     NUMBER(10) NOT NULL,
  likes       NUMBER(10) NOT NULL,
  captured_ms NUMBER(15)   NOT NULL,  -- epoch ms, idempotency key for retried writes
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT bt_eng_uk UNIQUE (ca, captured_ms)
)
/
CREATE TABLE bt_price_snapshots (
  id          NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT bt_price_pk PRIMARY KEY,
  ca          VARCHAR2(42) NOT NULL CONSTRAINT bt_price_coin_fk REFERENCES bt_coins (ca),
  price_usd   NUMBER NOT NULL,
  mcap_usd    NUMBER,
  captured_ms NUMBER(15)   NOT NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT bt_price_uk UNIQUE (ca, captured_ms)
)
/
CREATE TABLE bt_health_checks (
  id         VARCHAR2(64) CONSTRAINT bt_health_pk PRIMARY KEY,
  note       VARCHAR2(128),
  written_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
)
/
CREATE OR REPLACE VIEW bt_callers AS
SELECT u.telegram_id, u.username, u.first_name, u.x_handle,
       (SELECT COUNT(*) FROM bt_calls c WHERE c.caller_id = u.telegram_id) AS calls,
       (SELECT COUNT(*) FROM bt_calls c WHERE c.caller_id = u.telegram_id
          AND c.call_price_usd > 0 AND c.ath_price_usd / c.call_price_usd >= 2) AS hits,
       (SELECT MAX(c.ath_price_usd / NULLIF(c.call_price_usd, 0)) FROM bt_calls c WHERE c.caller_id = u.telegram_id) AS best_x,
       (SELECT COUNT(*) FROM bt_tags t WHERE t.telegram_id = u.telegram_id) AS tags
FROM bt_users u
/
