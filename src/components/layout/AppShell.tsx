"use client";

import DarkMode from "@mui/icons-material/DarkMode";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import FactCheck from "@mui/icons-material/FactCheck";
import ShoppingCartCheckout from "@mui/icons-material/ShoppingCartCheckout";
import Inventory from "@mui/icons-material/Inventory";
import LocalShipping from "@mui/icons-material/LocalShipping";
import Menu from "@mui/icons-material/Menu";
import MoveDown from "@mui/icons-material/MoveDown";
import Package2 from "@mui/icons-material/Inventory2";
import PlaylistAddCheck from "@mui/icons-material/PlaylistAddCheck";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import Undo from "@mui/icons-material/Undo";
import Close from "@mui/icons-material/Close";
import LightMode from "@mui/icons-material/LightMode";
import ListAlt from "@mui/icons-material/ListAlt";
import Logout from "@mui/icons-material/Logout";
import MonitorHeart from "@mui/icons-material/MonitorHeart";
import ManageAccounts from "@mui/icons-material/ManageAccounts";
import MoveToInbox from "@mui/icons-material/MoveToInbox";
import SpaceDashboard from "@mui/icons-material/SpaceDashboard";
import Alert from "@mui/material/Alert";
import BottomNavigation from "@mui/material/BottomNavigation";
import BottomNavigationAction from "@mui/material/BottomNavigationAction";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import { useColorScheme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NetworkStatus } from "./NetworkStatus";
import { logout as logoutRequest } from "@/services/api/authService";
import { useDraftStore, useSessionStore } from "@/store/uiStore";

export interface ShellUser {
  displayName: string;
  userId: string;
  roles: string[];
  permissions: string[];
  warehouseCodes: string[];
}

const NAV = [
  {
    href: "/dashboard",
    label: "Home",
    icon: <SpaceDashboard />,
    perm: "dashboard:view",
  },
  {
    href: "/inbound/receiving",
    label: "Receiving",
    icon: <MoveToInbox />,
    perm: "receiving:submit",
  },
  {
    href: "/inbound/putaway",
    label: "Put-away",
    icon: <MoveDown />,
    perm: "putaway:submit",
  },
  {
    href: "/inventory/items",
    label: "Items",
    icon: <Inventory2Outlined />,
    perm: "items:view",
  },
  {
    href: "/inventory/movements",
    label: "Movements",
    icon: <SwapHoriz />,
    perm: "movements:submit",
  },
  {
    href: "/inventory/cycle-count",
    label: "Cycle Count",
    icon: <FactCheck />,
    perm: "cyclecounts:submit",
  },
  {
    href: "/inventory/adjustments",
    label: "Adjustments",
    icon: <Inventory />,
    perm: "inventory:adjust",
  },
  {
    href: "/outbound/picking",
    label: "Picking",
    icon: <ShoppingCartCheckout />,
    perm: "picking:submit",
  },
  {
    href: "/outbound/packing",
    label: "Packing",
    icon: <Package2 />,
    perm: "packing:submit",
  },
  {
    href: "/outbound/shipping",
    label: "Shipping",
    icon: <LocalShipping />,
    perm: "shipping:submit",
  },
  {
    href: "/returns",
    label: "Returns",
    icon: <Undo />,
    perm: "returns:submit",
  },
  {
    href: "/quality/inspection",
    label: "Quality",
    icon: <PlaylistAddCheck />,
    perm: "quality:submit",
  },
  {
    href: "/tasks",
    label: "Transactions",
    icon: <ListAlt />,
    perm: "transactions:view",
  },
  {
    href: "/administration/users",
    label: "User Administration",
    icon: <ManageAccounts />,
    perm: "administration:administer",
  },
  {
    href: "/administration/integration-monitor",
    label: "Integration Monitor",
    icon: <MonitorHeart />,
    perm: "administration:administer",
  },
] as const;

const RAIL = 232;

export function AppShell({
  user,
  csrfToken,
  mockMode,
  children,
}: {
  user: ShellUser;
  csrfToken: string;
  mockMode: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { mode, setMode } = useColorScheme();
  const {
    setCsrfToken,
    setUserId,
    selectedLocation,
    setSelectedLocation,
    setWarehouseCodes,
  } = useSessionStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Depend on warehouse contents, not the array identity, to avoid rerunning this
  // synchronization effect when a parent creates an equivalent array on rerender.
  const warehouseCodesKey = JSON.stringify(user.warehouseCodes);

  useEffect(() => {
    const warehouseCodes = JSON.parse(warehouseCodesKey) as string[];
    const current = useSessionStore.getState();

    if (current.csrfToken !== csrfToken) {
      setCsrfToken(csrfToken);
    }

    if (current.userId !== user.userId) {
      setUserId(user.userId);
    }

    const currentWarehouseCodes = current.warehouseCodes;
    const sameWarehouseCodes =
      currentWarehouseCodes.length === warehouseCodes.length &&
      currentWarehouseCodes.every(
        (code, index) => code === warehouseCodes[index],
      );

    if (!sameWarehouseCodes) {
      setWarehouseCodes(warehouseCodes);
    }

    const currentLocation = current.selectedLocation;
    const nextLocation: string =
      currentLocation && warehouseCodes.includes(currentLocation)
        ? currentLocation
        : (warehouseCodes[0] ?? "");

    if (currentLocation !== nextLocation) {
      setSelectedLocation(nextLocation);
    }
  }, [
    csrfToken,
    user.userId,
    warehouseCodesKey,
    setCsrfToken,
    setUserId,
    setSelectedLocation,
    setWarehouseCodes,
  ]);

  const items = NAV.filter((n) => user.permissions.includes(n.perm));
  const active = items.find((n) => pathname.startsWith(n.href));

  const handleLogout = async () => {
    try {
      // Use the imported API function. Naming this handler "logout" would shadow
      // the import and recursively call the handler instead of the API request.
      await logoutRequest();
    } catch {
      // Complete local sign-out even if the server session was already invalid
      // or the session store is temporarily unavailable. The endpoint independently
      // verifies same-origin and clears the session cookie.
    } finally {
      useDraftStore.getState().reset();
      useSessionStore.setState({
        csrfToken: null,
        selectedLocation: null,
        warehouseCodes: [],
        userId: null,
      });
      qc.clear();
      router.replace("/login");
    }
  };

  const toggleMode = () => setMode(mode === "dark" ? "light" : "dark");

  const warehouse = user.warehouseCodes.length > 0 && (
    <Select
      size="small"
      value={selectedLocation ?? ""}
      onChange={(e) => setSelectedLocation(String(e.target.value))}
      inputProps={{ "aria-label": "Warehouse" }}
      sx={{
        minWidth: 96,
        "& .MuiSelect-select": { py: 0.75, fontWeight: 600 },
      }}
    >
      {user.warehouseCodes.map((code) => (
        <MenuItem key={code} value={code}>
          {code}
        </MenuItem>
      ))}
    </Select>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      {/* Desktop navigation */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", lg: "block" },
          width: RAIL,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: RAIL,
            bgcolor: "ink",
            color: "#E6EDF3",
            border: 0,
          },
        }}
      >
        <Box sx={{ px: 2.5, pt: 3, pb: 2 }}>
          <Typography
            variant="h3"
            sx={{ color: "#fff", letterSpacing: "-0.01em" }}
          >
            Velvotix WMS
          </Typography>
          <Typography variant="caption" sx={{ color: "#9AA9B7" }}>
            Warehouse execution
          </Typography>
        </Box>
        <List component="nav" aria-label="Main" sx={{ px: 1 }}>
          {items.map((item) => (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={active?.href === item.href}
              sx={{
                borderRadius: "2px",
                mb: 0.25,
                borderLeft: 4,
                borderColor: "transparent",
                py: 1,
                "&.Mui-selected": {
                  bgcolor: "rgba(255,255,255,.08)",
                  borderColor: "secondary.main",
                },
                "&.Mui-selected:hover, &:hover": {
                  bgcolor: "rgba(255,255,255,.12)",
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: "inherit" }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: {
                    fontWeight: active?.href === item.href ? 600 : 400,
                  },
                }}
              />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ p: 2, borderTop: 1, borderColor: "rgba(255,255,255,.12)" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {user.displayName}
          </Typography>
          <Typography variant="caption" sx={{ color: "#9AA9B7" }}>
            {user.userId}
          </Typography>
          {user.roles.map((role) => (
            <Typography
              key={role}
              variant="caption"
              sx={{ display: "block", color: "#B9C8D5" }}
            >
              {role}
            </Typography>
          ))}
        </Box>
      </Drawer>

      {/* Mobile navigation drawer */}
      <Drawer
        anchor="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        sx={{
          display: { xs: "block", lg: "none" },
          "& .MuiDrawer-paper": { width: { xs: 300, sm: 360 }, maxWidth: "88vw" },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Box>
            <Typography variant="h3">Velvotix WMS</Typography>
            <Typography variant="caption" color="text.secondary">
              Role-specific workspace
            </Typography>
          </Box>
          <IconButton
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
          >
            <Close />
          </IconButton>
        </Stack>
        <List
          component="nav"
          aria-label="All warehouse workspaces"
          sx={{ px: 1 }}
        >
          {items.map((item) => (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={active?.href === item.href}
              onClick={() => setMobileMenuOpen(false)}
              sx={{ borderRadius: 1, mb: 0.25 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ mt: "auto", p: 2, borderTop: 1, borderColor: "divider" }}>
          <Typography fontWeight={600}>{user.displayName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {user.userId}
          </Typography>
          {user.roles.map((role) => (
            <Typography
              key={role}
              variant="caption"
              color="text.secondary"
              sx={{ display: "block" }}
            >
              {role}
            </Typography>
          ))}
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          pb: { xs: "calc(80px + env(safe-area-inset-bottom, 0px))", lg: 0 },
        }}
      >
        {mockMode && (
          <Alert
            severity="warning"
            icon={false}
            sx={{ borderRadius: 0, py: 0 }}
          >
            Mock mode: data is simulated and nothing is sent to Business
            Central.
          </Alert>
        )}
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{
            px: { xs: 1, sm: 2, lg: 3 },
            py: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            position: "sticky",
            top: 0,
            zIndex: 10,
            pt: "calc(8px + env(safe-area-inset-top, 0px))",
          }}
        >
          <IconButton
            aria-label="Open all warehouse workspaces"
            onClick={() => setMobileMenuOpen(true)}
            sx={{ display: { xs: "inline-flex", lg: "none" }, width: 48, height: 48 }}
          >
            <Menu />
          </IconButton>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 600,
              display: { xs: "block", lg: "none" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {active?.label ?? "Velvotix WMS"}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <NetworkStatus />
          {warehouse}
          <Tooltip
            title={mode === "dark" ? "Switch to light" : "Switch to dark"}
          >
            <IconButton
              onClick={toggleMode}
              aria-label="Toggle colour mode"
              size="small"
            >
              {mode === "dark" ? <LightMode /> : <DarkMode />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Sign out">
            <IconButton
              onClick={handleLogout}
              aria-label="Sign out"
              size="small"
            >
              <Logout />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box
          sx={{
            flexGrow: 1,
            px: { xs: 1.5, sm: 2.5, lg: 4 },
            py: { xs: 1.5, sm: 2.5, lg: 3 },
            maxWidth: 1500,
            width: "100%",
            mx: "auto",
          }}
        >
          {children}
        </Box>
      </Box>

      <BottomNavigation
        component="nav"
        aria-label="Main"
        showLabels
        value={active?.href ?? false}
        sx={{
          display: { xs: "flex", lg: "none" },
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: 1,
          borderColor: "divider",
          height: "calc(80px + env(safe-area-inset-bottom, 0px))",
          pb: "env(safe-area-inset-bottom, 0px)",
          zIndex: 20,
        }}
      >
        {items
          .filter((item) =>
            [
              "/dashboard",
              "/inbound/receiving",
              "/inventory/items",
              "/outbound/picking",
              "/outbound/shipping",
            ].includes(item.href),
          )
          .slice(0, 5)
          .map((item) => (
            <BottomNavigationAction
              key={item.href}
              component={Link}
              href={item.href}
              value={item.href}
              label={item.href === "/dashboard" ? "Home" : item.href === "/inbound/receiving" ? "Receive" : item.href === "/inventory/items" ? "Items" : item.href === "/outbound/picking" ? "Pick" : item.href === "/outbound/shipping" ? "Ship" : item.label}
              icon={item.icon}
              sx={{ minWidth: 0, flex: "1 1 0", px: 0.25, "& .MuiBottomNavigationAction-label": { fontSize: "0.68rem", whiteSpace: "nowrap" }, "& .MuiSvgIcon-root": { fontSize: 25 }, "&.Mui-selected": { color: "primary.main" } }}
            />
          ))}
      </BottomNavigation>
    </Box>
  );
}
