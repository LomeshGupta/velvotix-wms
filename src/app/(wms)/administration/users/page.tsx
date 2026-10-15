import type { Metadata } from "next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireWmsPagePermission } from "@/lib/security/page-access";

export const metadata: Metadata = { title: "WMS User Administration" };

export default async function Page() {
  await requireWmsPagePermission("administration:administer");
  return (
    <>
      <PageHeader title="WMS User Administration" subtitle="User identity, passwords, roles, permissions and warehouse access are managed in Business Central." />
      <Box sx={{ maxWidth: 900 }}>
        <Stack spacing={2}>
          <Alert severity="info">Password values and password hashes are never managed in the WMS browser application. Sign-in is verified by the published VWMSAuth codeunit inside Business Central.</Alert>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h2" sx={{ mb: 1 }}>Manage a WMS user in Business Central</Typography>
            <List dense>
              <ListItem><ListItemText primary="1. Open WMS Setup → WMS Users." /></ListItem>
              <ListItem><ListItemText primary="2. Create the user and set the status to Active." /></ListItem>
              <ListItem><ListItemText primary="3. Assign the user's WMS role(s), permissions where required, and warehouse access." /></ListItem>
              <ListItem><ListItemText primary="4. From the WMS Users page, use Set Password to set the initial WMS login password. The password is salted and hashed in Business Central." /></ListItem>
              <ListItem><ListItemText primary="5. Sign in to Velvotix WMS using the same User ID and password." /></ListItem>
            </List>
          </Paper>
          <Typography variant="body2" color="text.secondary">If login fails, check that the WMS is enabled in WMS Setup, the user is Active, the password has been set, the account is not locked, and the app registration has access to both WMS APIs and the ODataV4 authentication service.</Typography>
        </Stack>
      </Box>
    </>
  );
}
