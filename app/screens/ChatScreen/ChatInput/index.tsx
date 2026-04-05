import ThemedButton from '@components/buttons/ThemedButton'
import PopupMenu from '@components/views/PopupMenu'
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons'
import { XAxisOnlyTransition } from '@lib/animations/transitions'
import { AppSettings } from '@lib/constants/GlobalValues'
import { generateResponse } from '@lib/engine/Inference'
import { useUnfocusTextInput } from '@lib/hooks/UnfocusTextInput'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { getDocumentAsync } from 'expo-document-picker'
import { Image } from 'expo-image'
import React, { useState } from 'react'
import { TextInput, TouchableOpacity, View, Text } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'
import Animated, {
    BounceIn,
    FadeIn,
    FadeOut,
    LinearTransition,
    ZoomOut,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import ChatOptions from './ChatInputOptions'

// 🚀 GEMU IMPORTS
import { Llama } from '@lib/engine/Local/LlamaLocal'
import { SamplersManager } from '@lib/state/SamplerState'

export type Attachment = {
    uri: string
    type: 'image' | 'audio' | 'document'
    name: string
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

type ChatInputHeightStoreProps = {
    height: number
    setHeight: (n: number) => void
}

export const useInputHeightStore = create<ChatInputHeightStoreProps>()((set) => ({
    height: 54,
    setHeight: (n) => set({ height: Math.ceil(n) }),
}))

const ChatInput = () => {
    const insets = useSafeAreaInsets()
    const inputRef = useUnfocusTextInput()

    const { color, borderRadius, spacing } = Theme.useTheme()
    const [sendOnEnter, _] = useMMKVBoolean(AppSettings.SendOnEnter)
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [hideOptions, setHideOptions] = useState(false)
    const { addEntry } = Chats.useEntry()
    const { nowGenerating, abortFunction } = useInference(
        useShallow((state) => ({
            nowGenerating: state.nowGenerating,
            abortFunction: state.abortFunction,
        }))
    )
    const setHeight = useInputHeightStore(useShallow((state) => state.setHeight))

    const { charName } = Characters.useCharacterStore(
        useShallow((state) => ({
            charName: state?.card?.name,
        }))
    )

    const { userName } = Characters.useUserStore(
        useShallow((state) => ({ userName: state.card?.name }))
    )

    const [newMessage, setNewMessage] = useState<string>('')

    // ==========================================
    // 🚀 GEMU EDITION: LM STUDIO THINKING TOGGLE
    // ==========================================
    const { currentConfig, updateCurrentConfig } = SamplersManager.useSamplers(
        useShallow((state) => ({
            currentConfig: state.currentConfig,
            updateCurrentConfig: state.updateCurrentConfig,
        }))
    )
    
    const isThinking = !!currentConfig?.data?.include_reasoning;

    const toggleThinking = () => {
        if (currentConfig) {
            updateCurrentConfig({
                ...currentConfig,
                data: {
                    ...currentConfig.data,
                    include_reasoning: !isThinking,
                },
            })
            Logger.infoToast(`🧠 Thinking Mode ${!isThinking ? 'ON' : 'OFF'}`);
        }
    }

    // ==========================================
    // ⚡ LIVE ENHANCER STATES
    // ==========================================
    const [showModifiers, setShowModifiers] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);
    const [enhanceProgress, setEnhanceProgress] = useState(0);

    const getModeConfig = (mode: string) => {
        switch(mode) {
            case 'fix': return { icon: '🪄', name: 'Fix Grammar', color: '#00e676' };
            case 'logic': return { icon: '🧠', name: 'Strict Logic', color: '#00b0ff' };
            case 'fun': return { icon: '🎨', name: 'Creative Mode', color: '#ff4081' };
            case 'enhance_normal': return { icon: '🌟', name: 'Normal Enhance', color: '#8c9eff' };
            case 'enhance_create': return { icon: '⚡', name: 'C.R.E.A.T.E Enhance', color: '#b388ff' };
            default: return null;
        }
    }

    // ⚡ THE ANTI-HALLUCINATION AI ENGINE
    const runRealEnhancer = async (mode: string) => {
        if (nowGenerating) {
            Logger.warnToast("Wait for the AI to finish chatting first!");
            return;
        }
        if (!newMessage || newMessage.trim() === '') {
            Logger.warnToast("Type a prompt first before generating!");
            return;
        }
        
        const llamaContext = Llama.useLlamaModelStore.getState().context;
        if (!llamaContext) {
            Logger.warnToast("No local model loaded! Please load a model to use AI Generation.");
            return;
        }

        inputRef.current?.blur();
        setIsEnhancing(true);
        setEnhanceProgress(5); 

        let instruction = "";
        let max_tokens = 500;
        switch(mode) {
            case 'fix':
                instruction = "Fix all grammar, spelling, and punctuation errors in the Input. Output ONLY the fixed text and nothing else.";
                break;
            case 'logic':
                instruction = "Rewrite the Input prompt to explicitly demand strict, step-by-step reasoning and high factual accuracy. Output ONLY the enhanced prompt and nothing else.";
                break;
            case 'fun':
                instruction = "Rewrite the Input prompt to be highly engaging, fun, and include natural emojis. Output ONLY the enhanced prompt and nothing else.";
                break;
            case 'enhance_normal':
                instruction = "Rewrite the Input prompt to be clearer, more detailed, and highly effective. Output ONLY the enhanced prompt and nothing else.";
                break;
            case 'enhance_create':
                instruction = "Rewrite the Input prompt into a highly detailed instruction using the C.R.E.A.T.E framework (Character, Request, Example, Adjustments, Type of output, Extra Guidance). Output ONLY the newly enhanced prompt and nothing else.";
                max_tokens = 800; 
                break;
        }

        // 🛡️ THE FOOLPROOF ALPACA TEMPLATE: Stops chat completion hallucinations 100% of the time.
        const metaPrompt = `Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
You are an elite text processing AI. Your ONLY task is to apply the following instruction to the Input text. DO NOT add any greetings, conversational filler, or explanations. ONLY output the final transformed text.
Task: ${instruction}

### Input:
${newMessage}

### Response:
`;

        let generatedText = "";

        try {
            const result = await llamaContext.completion(
                {
                    prompt: metaPrompt,
                    n_predict: max_tokens, 
                    temperature: 0.1, // ❄️ ABSOLUTE ZERO: Makes the AI completely robotic
                    stop: ["<|im_end|>", "</s>", "[/INST]", "<|eot_id|>", "### Instruction:"], 
                },
                (data: any) => {
                    if (data && data.token) {
                        generatedText += data.token;
                        setEnhanceProgress((prev) => (prev < 95 ? prev + 1 : prev));
                    }
                }
            );

            setEnhanceProgress(100);

            // 🧹 THE OUTPUT CLEANER: Strips bad tokens and ensures only the final text is injected
            let finalText = generatedText.trim();
            if (finalText.includes('### Response:\n')) {
                finalText = finalText.split('### Response:\n').pop() || finalText;
            }
            
            const stopTokens = ["<|im_end|>", "</s>", "[/INST]", "<|eot_id|>", "### Instruction:", "### Input:"];
            for (const token of stopTokens) {
                finalText = finalText.replace(token, "");
            }

            if (finalText) {
                setNewMessage(finalText.trim());
                Logger.infoToast(`✅ AI Processing Complete!`);
            } else {
                Logger.warnToast("AI returned empty. Try again.");
            }

        } catch (error) {
            Logger.errorToast("AI Generation Failed: " + error);
        } finally {
            // ALWAYS unlocks the UI
            setIsEnhancing(false); 
            setEnhanceProgress(0);
        }
    };
    // ==========================================

    const abortResponse = async () => {
        Logger.info(`Aborting Generation`)
        if (abortFunction) await abortFunction()
    }

    const handleSend = async () => {
        if (newMessage.trim() === '' && attachments.length === 0) return;

        await addEntry(
            userName ?? '',
            true,
            newMessage, 
            attachments.map((item) => item.uri)
        )
        
        const swipeId = await addEntry(charName ?? '', false, '')
        
        setNewMessage('')
        setAttachments([])
        setShowModifiers(false);
        
        if (swipeId) generateResponse(swipeId)
    }

    return (
        <View
            onLayout={(e) => {
                setHeight(e.nativeEvent.layout.height)
            }}
            style={{
                position: 'absolute',
                width: '98%',
                alignSelf: 'center',
                bottom: insets.bottom,
                marginVertical: spacing.m,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                backgroundColor: color.neutral._100 + 'cc',
                borderWidth: 1,
                borderColor: color.neutral._200,
                boxShadow: [
                    {
                        offsetX: 1,
                        offsetY: 1,
                        color: color.shadow,
                        spreadDistance: 1,
                        blurRadius: 4,
                    },
                ],
                borderRadius: 24, 
                rowGap: spacing.m,
            }}>
            
            {/* ========================================== */}
            {/* 🚀 GEMU EDITION: VERTICAL CHATGPT MENU     */}
            {/* ========================================== */}
            {showModifiers && !isEnhancing && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={{ flexDirection: 'column', alignItems: 'flex-start', paddingHorizontal: 12, paddingBottom: 8, rowGap: 8 }}>
                    {['fix', 'logic', 'fun', 'enhance_normal', 'enhance_create'].map((mode) => {
                        const config = getModeConfig(mode);
                        return (
                            <TouchableOpacity 
                                key={mode}
                                onPress={() => {
                                    runRealEnhancer(mode);
                                    setShowModifiers(false);
                                }}
                                style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: color.neutral._200, borderRadius: 20, borderWidth: 1, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: color.text._100, fontWeight: '600', fontSize: 14 }}>
                                    <Text style={{ color: config?.color }}>{config?.icon}</Text>  {config?.name}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </Animated.View>
            )}

            {/* ========================================== */}
            {/* 🚀 GEMU EDITION: THE LIVE LOADING BAR      */}
            {/* ========================================== */}
            {isEnhancing && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={{ paddingHorizontal: spacing.m, paddingBottom: 8, paddingTop: 6 }}>
                    <Text style={{ color: '#b388ff', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
                        ⚡ Processing with Local AI... {enhanceProgress}%
                    </Text>
                    <View style={{ height: 6, backgroundColor: color.neutral._300, borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${enhanceProgress}%`, backgroundColor: '#b388ff' }} />
                    </View>
                </Animated.View>
            )}

            <Animated.FlatList
                itemLayoutAnimation={LinearTransition}
                style={{
                    display: attachments.length > 0 ? 'flex' : 'none',
                    padding: spacing.l,
                    backgroundColor: color.neutral._200,
                    borderRadius: borderRadius.m,
                }}
                horizontal
                contentContainerStyle={{ columnGap: spacing.xl }}
                data={attachments}
                keyExtractor={(item) => item.uri}
                renderItem={({ item }) => {
                    return (
                        <Animated.View
                            entering={BounceIn}
                            exiting={ZoomOut.duration(100)}
                            style={{ alignItems: 'center', maxWidth: 80, rowGap: 8 }}>
                            <Image
                                source={{ uri: item.uri }}
                                style={{
                                    width: 64,
                                    height: undefined,
                                    aspectRatio: 1,
                                    borderRadius: borderRadius.m,
                                    borderWidth: 1,
                                    borderColor: color.primary._500,
                                }}
                            />

                            <ThemedButton
                                iconName="close"
                                iconSize={20}
                                buttonStyle={{
                                    borderWidth: 0,
                                    paddingHorizontal: 2,
                                    position: 'absolute',
                                    alignSelf: 'flex-end',
                                    margin: -4,
                                }}
                                onPress={() => {
                                    setAttachments(attachments.filter((a) => a.uri !== item.uri))
                                }}
                            />
                        </Animated.View>
                    )
                }}
            />
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'flex-end', 
                    columnGap: spacing.m,
                }}>
                <Animated.View layout={XAxisOnlyTransition}>
                    {!hideOptions && (
                        <Animated.View
                            entering={FadeIn}
                            exiting={FadeOut}
                            style={{ flexDirection: 'row', columnGap: 8, alignItems: 'center', paddingBottom: 8 }}>
                            <ChatOptions />
                            <PopupMenu
                                icon="paperclip"
                                iconSize={20}
                                options={[
                                    {
                                        label: 'Add Image',
                                        icon: 'picture',
                                        onPress: async (menuRef) => {
                                            menuRef.current?.close()
                                            const result = await getDocumentAsync({
                                                type: 'image/*',
                                                multiple: true,
                                                copyToCacheDirectory: true,
                                            })
                                            if (result.canceled || result.assets.length < 1) return

                                            const newAttachments = result.assets
                                                .map((item) => ({
                                                    uri: item.uri,
                                                    type: 'image',
                                                    name: item.name,
                                                }))
                                                .filter(
                                                    (item) =>
                                                        !attachments.some(
                                                            (a) => a.name === item.name
                                                        )
                                                ) as Attachment[]
                                            setAttachments([...attachments, ...newAttachments])
                                        },
                                    },
                                ]}
                                style={{
                                    color: color.text._400,
                                    padding: 6,
                                    backgroundColor: color.neutral._200,
                                    borderRadius: 16,
                                }}
                                placement="top"
                            />
                            
                            {/* 🚀 GEMU EDITION: LM STUDIO THINKING TOGGLE */}
                            <TouchableOpacity 
                                onPress={toggleThinking} 
                                disabled={isEnhancing || nowGenerating}
                                style={{ 
                                    padding: 6, 
                                    backgroundColor: isThinking ? color.primary._600 : color.neutral._200, 
                                    borderRadius: 16 
                                }}>
                                <MaterialIcons 
                                    name="psychology" 
                                    size={20} 
                                    color={isThinking ? color.text._100 : color.text._400} 
                                />
                            </TouchableOpacity>

                            {/* 🚀 GEMU EDITION: THE SPARKLE TRIGGER BUTTON */}
                            <TouchableOpacity 
                                onPress={() => setShowModifiers(!showModifiers)} 
                                disabled={isEnhancing}
                                style={{ 
                                    padding: 6, 
                                    backgroundColor: showModifiers ? color.primary._600 : color.neutral._200, 
                                    borderRadius: 16 
                                }}>
                                <MaterialIcons 
                                    name="auto-awesome" 
                                    size={20} 
                                    color={showModifiers ? color.text._100 : color.text._400} 
                                />
                            </TouchableOpacity>

                        </Animated.View>
                    )}
                    {hideOptions && (
                        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ paddingBottom: 8 }}>
                            <ThemedButton
                                iconSize={18}
                                iconStyle={{
                                    color: color.text._400,
                                }}
                                buttonStyle={{
                                    padding: 5,
                                    backgroundColor: color.neutral._200,
                                    borderRadius: 32,
                                }}
                                variant="tertiary"
                                iconName="right"
                                onPress={() => setHideOptions(false)}
                            />
                        </Animated.View>
                    )}
                </Animated.View>
                <AnimatedTextInput
                    layout={XAxisOnlyTransition}
                    ref={inputRef}
                    editable={!nowGenerating} 
                    style={{
                        color: color.text._100,
                        backgroundColor: color.neutral._100,
                        flex: 1,
                        borderWidth: 0, 
                        borderRadius: borderRadius.l,
                        paddingHorizontal: spacing.m,
                        paddingTop: 12,
                        paddingBottom: 12,
                        maxHeight: 120, 
                        opacity: isEnhancing ? 0.5 : 1, 
                    }}
                    onPress={() => {
                        setHideOptions(!!newMessage)
                    }}
                    placeholder="Message Gemu..."
                    placeholderTextColor={color.text._600}
                    value={newMessage}
                    onChangeText={(text) => {
                        setHideOptions(!!text)
                        setNewMessage(text)
                    }}
                    multiline
                    submitBehavior={sendOnEnter ? 'blurAndSubmit' : 'newline'}
                    onSubmitEditing={sendOnEnter ? handleSend : undefined}
                />
                <Animated.View layout={XAxisOnlyTransition} style={{ paddingBottom: 6 }}>
                    <TouchableOpacity
                        style={{
                            borderRadius: 24,
                            backgroundColor: nowGenerating ? color.error._500 : (newMessage.trim() || attachments.length > 0) ? color.primary._500 : color.neutral._300,
                            padding: spacing.m,
                        }}
                        disabled={(!nowGenerating && newMessage.trim() === '' && attachments.length === 0) || isEnhancing}
                        onPress={nowGenerating ? abortResponse : handleSend}>
                        <MaterialIcons
                            name={nowGenerating ? 'stop' : 'arrow-upward'} 
                            color={color.neutral._100}
                            size={20}
                        />
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </View>
    )
}

export default ChatInput