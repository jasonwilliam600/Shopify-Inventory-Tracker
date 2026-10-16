-- REVIEW ONLY. NOT EXECUTED. NOT CONNECTED TO STARTUP OR A MIGRATION RUNNER.
-- Proposed DEVELOPMENT database migration for Top Speed Hobbies.
-- Requires explicit approval of this final SQL before execution.
-- No statements reference existing supplier or inventory tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Do not use IF NOT EXISTS: unexpected existing objects must stop the migration.
CREATE TABLE public.shopify_variant_catalog (
  shop text NOT NULL
    CHECK (shop = lower(btrim(shop)) AND shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  variant_gid text NOT NULL CHECK (variant_gid ~ '^gid://shopify/ProductVariant/[0-9]+$'),
  product_gid text NOT NULL CHECK (product_gid ~ '^gid://shopify/Product/[0-9]+$'),
  sku text,
  sku_key text COLLATE "C" GENERATED ALWAYS AS (nullif(btrim(sku), '')) STORED,
  product_title text NOT NULL,
  variant_title text NOT NULL,
  product_status text NOT NULL CHECK (product_status IN ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  selected_options jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(selected_options) = 'array'),
  shopify_updated_at timestamptz NOT NULL,
  snapshot_id uuid NOT NULL,
  snapshot_started_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  import_completed_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  PRIMARY KEY (shop, variant_gid),
  CHECK (snapshot_started_at <= observed_at AND observed_at <= import_completed_at)
);

-- Deliberately NON-UNIQUE: preserve duplicates rather than losing variants.
CREATE INDEX shopify_variant_catalog_current_sku_idx
  ON public.shopify_variant_catalog (shop, sku_key)
  WHERE is_current AND sku_key IS NOT NULL;
CREATE INDEX shopify_variant_catalog_current_product_idx
  ON public.shopify_variant_catalog (shop, product_gid)
  WHERE is_current;
CREATE INDEX shopify_variant_catalog_current_snapshot_idx
  ON public.shopify_variant_catalog (shop, snapshot_id)
  WHERE is_current;

CREATE TABLE public.supplier_mapping_decisions (
  shop text NOT NULL
    CHECK (shop = lower(btrim(shop)) AND shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  supplier text NOT NULL CHECK (supplier IN (
    'Heartland Hobby Wholesale', 'HobbyTyme', 'Walthers', 'MMD/Squadron'
  )),
  source_sku text COLLATE "C" NOT NULL CHECK (btrim(source_sku) <> ''),
  -- This key is for safety-hold lookup, NOT case-insensitive product matching.
  source_sku_key text COLLATE "C"
    GENERATED ALWAYS AS (upper(btrim(source_sku) COLLATE "C")) STORED,
  proposed_sku text,
  target_variant_gid text,
  decision text NOT NULL DEFAULT 'held'
    CHECK (decision IN ('held', 'rejected', 'candidate', 'approved')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  product_identity_verified boolean NOT NULL DEFAULT false,
  selling_unit_verified boolean NOT NULL DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  reviewed_catalog_snapshot_id uuid,
  review_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(review_evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shop, supplier, source_sku),
  FOREIGN KEY (shop, target_variant_gid)
    REFERENCES public.shopify_variant_catalog (shop, variant_gid)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT supplier_mapping_approval_requires_review CHECK (
    decision <> 'approved' OR (
      target_variant_gid IS NOT NULL
      AND product_identity_verified
      AND selling_unit_verified
      AND reviewed_by IS NOT NULL AND btrim(reviewed_by) <> ''
      AND reviewed_at IS NOT NULL
      AND reviewed_catalog_snapshot_id IS NOT NULL
      AND review_evidence <> '{}'::jsonb
    )
  )
);

CREATE INDEX supplier_mapping_decisions_hold_lookup_idx
  ON public.supplier_mapping_decisions (shop, supplier, source_sku_key)
  WHERE decision IN ('held', 'rejected');
CREATE INDEX supplier_mapping_decisions_target_idx
  ON public.supplier_mapping_decisions (shop, target_variant_gid)
  WHERE target_variant_gid IS NOT NULL;
-- Different suppliers may target the same variant. Two approved source offers
-- from the SAME supplier may not. Held/candidate collision evidence is retained.
CREATE UNIQUE INDEX supplier_mapping_decisions_one_approved_source_idx
  ON public.supplier_mapping_decisions (shop, supplier, target_variant_gid)
  WHERE decision = 'approved';

-- Exact frozen review inputs. All 212 review rows are MMD/Squadron.
-- Three appear in both lists: 212 review rows become 209 blocked source pairs.
-- Rejected CSV SHA-256:
-- c0ed989446fdd6052e4e76f2f8f5ed2cafa28bbe704750fa2c49bf0732bfb80b
-- Flagged CSV SHA-256:
-- 715b4372f7414e4fed2cbc1f686353507ce144c8b5fa50154f4ee9b23b3aef98
WITH rejected(source_sku, proposed_sku) AS (
  VALUES
    ('CPA144001', 'CPP-144001'), ('CPA72009', 'CPP-72009'),
    ('CPD72011', 'CPP-72011'), ('CPA72001', 'CPP-72001'),
    ('CPA72004', 'CPP-72004'), ('CPA72007', 'CPP-72007'),
    ('CPA72008', 'CPP-72008'), ('CPA72011', 'CPP-72011'),
    ('CPA72016', 'CPP-72016'), ('CPD72001', 'CPP-72001'),
    ('CPD72002', 'CPP-72002'), ('ICM72075', 'IBG-72075')
), flagged(source_sku, proposed_sku) AS (
  VALUES
    ('VJ70400', 'VAL70400'), ('VJ70800', 'VAL70800'), ('VJ70801', 'VAL70801'), ('VJ70802', 'VAL70802'), ('VJ70803', 'VAL70803'),
    ('VJ70804', 'VAL70804'), ('VJ70805', 'VAL70805'), ('VJ70806', 'VAL70806'), ('VJ70807', 'VAL70807'), ('VJ70808', 'VAL70808'),
    ('VJ70809', 'VAL70809'), ('VJ70810', 'VAL70810'), ('VJ70811', 'VAL70811'), ('VJ70812', 'VAL70812'), ('VJ70814', 'VAL70814'),
    ('VJ70815', 'VAL70815'), ('VJ70816', 'VAL70816'), ('VJ70817', 'VAL70817'), ('VJ70818', 'VAL70818'), ('VJ70819', 'VAL70819'),
    ('VJ70820', 'VAL70820'), ('VJ70821', 'VAL70821'), ('VJ70822', 'VAL70822'), ('VJ70823', 'VAL70823'), ('VJ70824', 'VAL70824'),
    ('VJ70825', 'VAL70825'), ('VJ70826', 'VAL70826'), ('VJ70827', 'VAL70827'), ('VJ70828', 'VAL70828'), ('VJ70829', 'VAL70829'),
    ('VJ70830', 'VAL70830'), ('VJ70833', 'VAL70833'), ('VJ70835', 'VAL70835'), ('VJ70836', 'VAL70836'), ('VJ70837', 'VAL70837'),
    ('VJ70838', 'VAL70838'), ('VJ70840', 'VAL70840'), ('VJ70841', 'VAL70841'), ('VJ70843', 'VAL70843'), ('VJ70844', 'VAL70844'),
    ('VJ70845', 'VAL70845'), ('VJ70846', 'VAL70846'), ('VJ70847', 'VAL70847'),
    ('VJ70850', 'VAL70850'), ('VJ70851', 'VAL70851'), ('VJ70856', 'VAL70856'), ('VJ70858', 'VAL70858'), ('VJ70859', 'VAL70859'),
    ('VJ70860', 'VAL70860'), ('VJ70861', 'VAL70861'), ('VJ70862', 'VAL70862'), ('VJ70863', 'VAL70863'), ('VJ70864', 'VAL70864'),
    ('VJ70865', 'VAL70865'), ('VJ70866', 'VAL70866'), ('VJ70867', 'VAL70867'), ('VJ70868', 'VAL70868'), ('VJ70869', 'VAL70869'),
    ('VJ70870', 'VAL70870'), ('VJ70871', 'VAL70871'), ('VJ70872', 'VAL70872'), ('VJ70873', 'VAL70873'), ('VJ70874', 'VAL70874'),
    ('VJ70875', 'VAL70875'), ('VJ70876', 'VAL70876'), ('VJ70877', 'VAL70877'), ('VJ70878', 'VAL70878'), ('VJ70879', 'VAL70879'),
    ('VJ70880', 'VAL70880'), ('VJ70881', 'VAL70881'), ('VJ70882', 'VAL70882'), ('VJ70883', 'VAL70883'), ('VJ70884', 'VAL70884'),
    ('VJ70885', 'VAL70885'), ('VJ70886', 'VAL70886'), ('VJ70887', 'VAL70887'), ('VJ70888', 'VAL70888'), ('VJ70889', 'VAL70889'),
    ('VJ70890', 'VAL70890'), ('VJ70891', 'VAL70891'), ('VJ70892', 'VAL70892'), ('VJ70893', 'VAL70893'), ('VJ70894', 'VAL70894'),
    ('VJ70895', 'VAL70895'), ('VJ70896', 'VAL70896'), ('VJ70897', 'VAL70897'), ('VJ70898', 'VAL70898'), ('VJ70899', 'VAL70899'),
    ('VJ70901', 'VAL70901'), ('VJ70902', 'VAL70902'), ('VJ70905', 'VAL70905'), ('VJ70906', 'VAL70906'), ('VJ70907', 'VAL70907'),
    ('VJ70908', 'VAL70908'), ('VJ70909', 'VAL70909'), ('VJ70911', 'VAL70911'), ('VJ70913', 'VAL70913'), ('VJ70914', 'VAL70914'),
    ('VJ70915', 'VAL70915'), ('VJ70916', 'VAL70916'), ('VJ70917', 'VAL70917'), ('VJ70918', 'VAL70918'), ('VJ70919', 'VAL70919'),
    ('VJ70920', 'VAL70920'), ('VJ70921', 'VAL70921'), ('VJ70922', 'VAL70922'), ('VJ70923', 'VAL70923'), ('VJ70924', 'VAL70924'),
    ('VJ70925', 'VAL70925'), ('VJ70926', 'VAL70926'), ('VJ70927', 'VAL70927'), ('VJ70928', 'VAL70928'), ('VJ70929', 'VAL70929'),
    ('VJ70930', 'VAL70930'), ('VJ70939', 'VAL70939'), ('VJ70940', 'VAL70940'), ('VJ70941', 'VAL70941'), ('VJ70943', 'VAL70943'),
    ('VJ70944', 'VAL70944'), ('VJ70945', 'VAL70945'), ('VJ70946', 'VAL70946'), ('VJ70947', 'VAL70947'), ('VJ70948', 'VAL70948'),
    ('VJ70949', 'VAL70949'), ('VJ70950', 'VAL70950'), ('VJ70951', 'VAL70951'), ('VJ70952', 'VAL70952'), ('VJ70953', 'VAL70953'),
    ('VJ70954', 'VAL70954'), ('VJ70955', 'VAL70955'), ('VJ70956', 'VAL70956'), ('VJ70957', 'VAL70957'), ('VJ70958', 'VAL70958'),
    ('VJ70959', 'VAL70959'), ('VJ70960', 'VAL70960'), ('VJ70961', 'VAL70961'), ('VJ70962', 'VAL70962'), ('VJ70963', 'VAL70963'),
    ('VJ70964', 'VAL70964'), ('VJ70965', 'VAL70965'), ('VJ70966', 'VAL70966'), ('VJ70967', 'VAL70967'), ('VJ70968', 'VAL70968'),
    ('VJ70969', 'VAL70969'), ('VJ70970', 'VAL70970'), ('VJ70971', 'VAL70971'), ('VJ70972', 'VAL70972'), ('VJ70974', 'VAL70974'),
    ('VJ70975', 'VAL70975'), ('VJ70976', 'VAL70976'), ('VJ70977', 'VAL70977'), ('VJ70978', 'VAL70978'), ('VJ70979', 'VAL70979'),
    ('VJ70980', 'VAL70980'), ('VJ70981', 'VAL70981'), ('VJ70982', 'VAL70982'), ('VJ70983', 'VAL70983'), ('VJ70984', 'VAL70984'),
    ('VJ70985', 'VAL70985'), ('VJ70986', 'VAL70986'), ('VJ70987', 'VAL70987'), ('VJ70988', 'VAL70988'), ('VJ70989', 'VAL70989'),
    ('VJ70990', 'VAL70990'), ('VJ70991', 'VAL70991'), ('VJ70992', 'VAL70992'), ('VJ70993', 'VAL70993'), ('VJ70994', 'VAL70994'),
    ('VJ70995', 'VAL70995'), ('VJ70996', 'VAL70996'), ('VJ70997', 'VAL70997'), ('VJ70998', 'VAL70998'), ('VJ70999', 'VAL70999'),
    ('VJ73101', 'VAL73101'), ('VJ73102', 'VAL73102'), ('VJ73103', 'VAL73103'), ('VJ73104', 'VAL73104'), ('VJ73105', 'VAL73105'),
    ('VJ73106', 'VAL73106'), ('VJ73107', 'VAL73107'), ('VJ73108', 'VAL73108'), ('VJ73109', 'VAL73109'), ('VJ73110', 'VAL73110'),
    ('VJ73111', 'VAL73111'), ('VJ73112', 'VAL73112'), ('VJ73113', 'VAL73113'), ('VJ73114', 'VAL73114'), ('VJ73115', 'VAL73115'),
    ('VJ73116', 'VAL73116'), ('VJ73117', 'VAL73117'), ('VJ73118', 'VAL73118'), ('VJ73119', 'VAL73119'), ('VJ73120', 'VAL73120'),
    ('VJ73121', 'VAL73121'), ('VJ73122', 'VAL73122'), ('VJ73123', 'VAL73123'), ('ILK63502', 'ILK-63502'), ('CPA144001', 'CPP-144001'),
    ('CPA72009', 'CPP-72009'), ('CPD72011', 'CPP-72011')
), review_rows AS (
  SELECT source_sku, proposed_sku, 'rejected'::text AS decision,
    CASE WHEN source_sku = 'ICM72075'
      THEN 'Rejected: different products, ICM aircraft versus IBG halftrack.'
      ELSE 'Rejected: accessory/decal versus model-kit product identity conflict.'
    END AS reason
  FROM rejected
  UNION ALL
  SELECT source_sku, proposed_sku, 'held'::text,
    CASE
      WHEN source_sku IN ('CPA144001', 'CPA72009', 'CPD72011')
        THEN 'Accessory vs model-kit wording — review'
      WHEN source_sku = 'ILK63502' THEN 'Scale differs: 1/35 vs 1/25'
      WHEN source_sku LIKE 'VJ73%' THEN 'Volume differs: 30ml vs 35ml'
      ELSE 'Volume differs: 17ml vs 18ml'
    END
  FROM flagged
)
INSERT INTO public.supplier_mapping_decisions (
  shop, supplier, source_sku, proposed_sku, decision, reason, review_evidence
)
SELECT
  'top-speed-hobbies.myshopify.com', 'MMD/Squadron', source_sku, min(proposed_sku),
  CASE WHEN bool_or(decision = 'rejected') THEN 'rejected' ELSE 'held' END,
  string_agg(DISTINCT reason, ' | ' ORDER BY reason),
  jsonb_build_object(
    'source', 'Existing Phase 1 safety review',
    'originally_rejected', bool_or(decision = 'rejected'),
    'originally_flagged', bool_or(decision = 'held'),
    'identity_approved', false,
    'selling_units_approved', false
  )
FROM review_rows
GROUP BY source_sku
HAVING count(DISTINCT proposed_sku) = 1;

-- Abort the whole transaction if the exact expected blocking state is absent.
DO $migration_assert$
BEGIN
  IF (SELECT count(*) FROM public.shopify_variant_catalog) <> 0
    OR (SELECT count(*) FROM public.supplier_mapping_decisions) <> 209
    OR (SELECT count(*) FROM public.supplier_mapping_decisions WHERE decision = 'rejected') <> 12
    OR (SELECT count(*) FROM public.supplier_mapping_decisions WHERE decision = 'held') <> 197
    OR (SELECT count(*) FROM public.supplier_mapping_decisions
        WHERE target_variant_gid IS NOT NULL OR product_identity_verified OR selling_unit_verified
          OR reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL
          OR reviewed_catalog_snapshot_id IS NOT NULL) <> 0
  THEN
    RAISE EXCEPTION 'Initial safety-state validation failed; migration must roll back';
  END IF;
END;
$migration_assert$;
COMMIT;
