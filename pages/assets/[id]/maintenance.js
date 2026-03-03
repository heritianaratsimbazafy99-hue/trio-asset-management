import { useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "../../../components/Layout";

export default function LegacyAssetMaintenanceRedirect() {
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    if (!id) return;
    router.replace(`/maintenance/new?asset_id=${id}`);
  }, [id, router]);

  return (
    <Layout>
      <p>Redirection vers le formulaire maintenance...</p>
    </Layout>
  );
}
