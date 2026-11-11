import { Button, Dialog, Portal, Text } from "@chakra-ui/react";
import { ExternalLink } from "deck.gl-raster-examples-shared";

/**
 * Props for {@link WebGpuNotice}.
 */
export type WebGpuNoticeProps = {
  /** Called when the dialog is closed. */
  onDismiss: () => void;
};

/**
 * Modal dialog shown when the browser has no WebGPU, which the models need.
 */
export function WebGpuNotice({ onDismiss }: WebGpuNoticeProps) {
  return (
    <Dialog.Root
      open
      role="alertdialog"
      placement="center"
      onOpenChange={(details) => {
        if (!details.open) {
          onDismiss();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>This example needs WebGPU</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text>
                The Similarity, Clusters and Classifier modes run their models
                on WebGPU, which this browser does not offer. Try a recent
                Chrome or Edge, or see{" "}
                <ExternalLink href="https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API#browser_compatibility">
                  which browsers support WebGPU
                </ExternalLink>
                .
              </Text>
              <Text mt="3">
                The RGB mode draws the embeddings without a model, so it still
                works here.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button size="sm" onClick={onDismiss}>
                Show the RGB mode
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
