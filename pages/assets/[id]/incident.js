import { useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "../../../components/Layout";

export default function LegacyAssetIncidentRedirect() {
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    if (!id) return;
    router.replace(`/incidents/new?asset_id=${id}`);
  }, [id, router]);

  return (
    <Layout>
      <p>Redirection vers le formulaire incident...</p>
    </Layout>
  );
}
